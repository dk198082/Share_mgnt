import { normalizeExpression, normalizeType } from "./azure-schema-model.mjs";

export const MIN_POSTGRES_VERSION_NUM = 150000;
export const SERVER_VERSION_QUERY =
  "SELECT pg_catalog.current_setting('server_version_num')::integer AS server_version_num";

// All relation references are pg_catalog objects. Never interpolate schema names,
// query application tables, evaluate defaults, or run SQL supplied by the database.
export const CATALOG_QUERIES = {
  tables: `
    SELECT c.relname AS name, c.relkind AS kind,
      c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')`,
  columns: `
    SELECT c.relname AS table_name, a.attname AS name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
      a.attnotnull AS not_null, a.attgenerated AS generated, a.attidentity AS identity,
      a.attcollation = typ.typcollation AS default_collation,
      pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression,
      (SELECT sn.nspname || '.' || s.relname FROM pg_catalog.pg_depend dep
        JOIN pg_catalog.pg_class s ON s.oid = dep.objid AND s.relkind = 'S'
        JOIN pg_catalog.pg_namespace sn ON sn.oid = s.relnamespace
        WHERE dep.classid = 'pg_catalog.pg_class'::regclass
          AND dep.refclassid = 'pg_catalog.pg_class'::regclass
          AND dep.refobjid = c.oid AND dep.refobjsubid = a.attnum
          AND dep.deptype IN ('a', 'i')) AS serial_sequence
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_type typ ON typ.oid = a.atttypid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped`,
  constraints: `
    SELECT t.relname AS table_name, c.conname AS name, c.contype AS kind,
      c.condeferrable AS deferrable, c.condeferred AS deferred, c.convalidated AS validated,
      c.connoinherit AS no_inherit, pg_catalog.pg_get_expr(c.conbin, c.conrelid) AS expression,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num, pos)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num ORDER BY k.pos) AS columns,
      fn.nspname AS foreign_schema, ft.relname AS foreign_table,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num, pos)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num ORDER BY k.pos) AS foreign_columns,
      c.confupdtype AS on_update, c.confdeltype AS on_delete, c.confmatchtype AS match,
      COALESCE(i.indnullsnotdistinct, false) AS nulls_not_distinct
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_catalog.pg_class ft ON ft.oid = c.confrelid
    LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid = ft.relnamespace
    LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.conindid
    WHERE n.nspname = $1 AND t.relkind IN ('r', 'p') AND c.contype <> 'n'`,
  indexes: `
    SELECT t.relname AS table_name, ic.relname AS name, am.amname AS method,
      i.indisunique AS unique, i.indisvalid AS valid, i.indisready AS ready,
      i.indnullsnotdistinct AS nulls_not_distinct,
      COALESCE(ic.reloptions, ARRAY[]::text[]) AS storage_parameters,
      pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate,
      ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid, p, false)
        FROM generate_series(1, i.indnkeyatts) p ORDER BY p) AS expressions,
      ARRAY(SELECT (i.indoption[p-1] & 1) = 0
        FROM generate_series(1, i.indnkeyatts) p ORDER BY p) AS ascending,
      ARRAY(SELECT CASE WHEN (i.indoption[p-1] & 2) = 2 THEN 'first' ELSE 'last' END
        FROM generate_series(1, i.indnkeyatts) p ORDER BY p) AS nulls,
      ARRAY(SELECT opc.opcdefault FROM generate_series(1, i.indnkeyatts) p
        JOIN pg_catalog.pg_opclass opc ON opc.oid = i.indclass[p-1] ORDER BY p) AS default_opclasses,
      ARRAY(SELECT i.indcollation[p-1] = COALESCE(a.attcollation, 0)
        FROM generate_series(1, i.indnkeyatts) p
        LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[p-1]
        ORDER BY p) AS default_collations,
      ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid, p, false)
        FROM generate_series(i.indnkeyatts+1, i.indnatts) p ORDER BY p) AS include
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = ic.relam
    WHERE n.nspname = $1 AND t.relkind IN ('r', 'p')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conindid = i.indexrelid AND c.contype IN ('p', 'u', 'x'))`,
};

const actions = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };

export async function readAzureSchema(client, schema) {
  const tables = Object.create(null);
  // Repeatable read prevents inconsistent catalog snapshots during concurrent DDL.
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = '15s'");
    const versionResult = await client.query(SERVER_VERSION_QUERY);
    const serverVersion = Number(versionResult.rows[0]?.server_version_num);
    if (!Number.isInteger(serverVersion) || serverVersion < MIN_POSTGRES_VERSION_NUM) {
      throw new Error("PostgreSQL 15 or newer is required for Azure schema inspection.");
    }
    const rows = {};
    for (const [kind, sql] of Object.entries(CATALOG_QUERIES)) {
      rows[kind] = (await client.query(sql, [schema])).rows;
    }
    for (const row of rows.tables) {
      if (row.name === "__app_schema_migrations") continue;
      if (!["r", "p"].includes(row.kind)) {
        throw new Error("Unsupported relation metadata in the Azure schema.");
      }
      tables[row.name] = {
        columns: Object.create(null), constraints: Object.create(null), indexes: Object.create(null),
        rls: row.rls, forceRls: row.force_rls,
      };
    }
    for (const row of rows.columns) {
      if (!tables[row.table_name]) continue;
      tables[row.table_name].columns[row.name] = {
        type: normalizeType(row.type), notNull: row.not_null,
        default: normalizeExpression(row.default_expression, row.table_name, row.type, schema),
        generated: row.generated, identity: row.identity, serialSequence: row.serial_sequence,
        defaultCollation: row.default_collation,
      };
    }
    for (const row of rows.constraints) {
      if (!tables[row.table_name]) continue;
      if (!["p", "u", "f", "c"].includes(row.kind)) {
        throw new Error("Unsupported constraint metadata in the Azure schema.");
      }
      const key = { kind: row.kind, deferrable: row.deferrable, deferred: row.deferred, validated: row.validated };
      if (["p", "u", "f"].includes(row.kind)) key.columns = row.columns;
      if (row.kind === "u") key.nullsNotDistinct = row.nulls_not_distinct;
      if (row.kind === "c") Object.assign(key, {
        expression: normalizeExpression(row.expression, row.table_name), noInherit: row.no_inherit,
      });
      if (row.kind === "f") Object.assign(key, {
        foreignSchema: row.foreign_schema, foreignTable: row.foreign_table, foreignColumns: row.foreign_columns,
        onUpdate: actions[row.on_update] ?? unsupportedMetadata("foreign-key update action"),
        onDelete: actions[row.on_delete] ?? unsupportedMetadata("foreign-key delete action"),
        match: ({ s: "simple", f: "full", p: "partial" })[row.match] ??
          unsupportedMetadata("foreign-key match type"),
      });
      tables[row.table_name].constraints[row.name] = key;
    }
    for (const row of rows.indexes) {
      if (!tables[row.table_name]) continue;
      tables[row.table_name].indexes[row.name] = {
        unique: row.unique, method: row.method, valid: row.valid, ready: row.ready,
        nullsNotDistinct: row.nulls_not_distinct, include: row.include,
        storageParameters: row.storage_parameters,
        columns: row.expressions.map((expression, i) => ({
          expression: normalizeExpression(expression, row.table_name),
          asc: row.ascending[i], nulls: row.nulls[i],
          defaultOpclass: row.default_opclasses[i], defaultCollation: row.default_collations[i],
        })),
        predicate: normalizeExpression(row.predicate, row.table_name),
      };
    }
    await client.query("COMMIT");
    return { tables };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

function unsupportedMetadata(kind) {
  throw new Error(`Unsupported ${kind} metadata in the Azure schema.`);
}
