import { parse } from "pgsql-ast-parser";

export function normalizeType(type) {
  return type.toLowerCase().replace(/\s+/g, " ").replace(/\s+\(/g, "(").replace(/,\s+/g, ",")
    .replace(/^varchar\b/, "character varying")
    .replace(/^timestamp$/, "timestamp without time zone");
}

// Parse expressions rather than deleting parentheses: grouping and string case matter.
// Only known PostgreSQL deparser rewrites are considered equivalent.
export function normalizeExpression(expression, table, columnType, schema = "public") {
  if (expression === undefined || expression === null) return null;
  const ast = parse(`SELECT ${expression}`)[0].columns[0].expr;
  function visit(node) {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== "object") return node;
    if (node.type === "ref" && node.table?.name === table) {
      const { table: ignored, ...ref } = node;
      return visit(ref);
    }
    if (node.type === "cast" && node.to.name === "regclass" && node.operand.type === "string") {
      const ref = parse(`SELECT ${node.operand.value}`)[0].columns[0].expr;
      if (ref.type !== "ref") throw new Error("Unsupported sequence reference.");
      return { type: "regclass", schema: ref.table?.name ?? schema, name: ref.name };
    }
    if (node.type === "cast" && ["string", "integer", "numeric", "boolean"].includes(node.operand.type)) {
      const target = normalizeType(node.to.name);
      if (target === "bigint" &&
          ["string", "integer"].includes(node.operand.type) &&
          /^-?\d+$/.test(String(node.operand.value)) && Number.isSafeInteger(Number(node.operand.value)) &&
          (Number(node.operand.value) > 2147483647 || Number(node.operand.value) < -2147483648)) {
        return visit({ type: "integer", value: Number(node.operand.value) });
      }
      if ((node === ast && target === normalizeType(columnType ?? "")) ||
          (node.operand.type === "string" && target === "text")) {
        return visit(node.operand);
      }
    }
    if (node.type === "binary" && node.op === "=" &&
        node.right.type === "call" && node.right.function.name.toLowerCase() === "any" &&
        node.right.args.length === 1 && node.right.args[0].type === "array") {
      return visit({
        type: "binary", op: "IN", left: node.left,
        right: { type: "list", expressions: node.right.args[0].expressions },
      });
    }
    // Stable key order makes independently constructed AST objects comparable.
    return Object.fromEntries(Object.keys(node).sort().map((key) => [key, visit(node[key])]));
  }
  return JSON.stringify(visit(ast));
}

export function expectedSchema(snapshot, schema) {
  const tables = Object.create(null);
  for (const table of Object.values(snapshot.tables)) {
    if (table.schema && table.schema !== "public" && table.schema !== schema) {
      throw new Error("Explicit cross-schema Drizzle tables are not supported by the drift check.");
    }
    if (table.policies && Object.keys(table.policies).length) {
      throw new Error("Drizzle policies require extending the drift check before release.");
    }
    const columns = Object.create(null);
    const constraints = Object.create(null);
    const indexes = Object.create(null);
    for (const column of Object.values(table.columns)) {
      if (column.generated || column.identity) {
        throw new Error("Generated/identity columns require extending the drift check before release.");
      }
      const serial = ["serial", "bigserial", "smallserial"].includes(column.type);
      const serialSequence = serial ? `${schema}.${table.name}_${column.name}_seq` : null;
      columns[column.name] = {
        type: serial ? { serial: "integer", bigserial: "bigint", smallserial: "smallint" }[column.type] : normalizeType(column.type),
        notNull: column.notNull,
        default: normalizeExpression(serial ? `nextval('"${schema}"."${table.name}_${column.name}_seq"'::regclass)` : column.default, table.name, column.type, schema),
        generated: "", identity: "", serialSequence, defaultCollation: true,
      };
    }
    const primary = Object.values(table.columns).filter((column) => column.primaryKey).map((column) => column.name);
    if (primary.length) constraints[`${table.name}_pkey`] = {
      kind: "p", columns: primary, deferrable: false, deferred: false, validated: true,
    };
    for (const key of Object.values(table.compositePrimaryKeys)) {
      constraints[key.name] = { kind: "p", columns: key.columns, deferrable: false, deferred: false, validated: true };
    }
    for (const key of Object.values(table.uniqueConstraints)) {
      constraints[key.name] = {
        kind: "u", columns: key.columns, nullsNotDistinct: key.nullsNotDistinct ?? false,
        deferrable: false, deferred: false, validated: true,
      };
    }
    for (const key of Object.values(table.foreignKeys)) {
      constraints[key.name] = {
        kind: "f", columns: key.columnsFrom, foreignSchema: key.schemaTo || schema,
        foreignTable: key.tableTo, foreignColumns: key.columnsTo,
        onUpdate: key.onUpdate ?? "no action", onDelete: key.onDelete ?? "no action",
        match: "simple", deferrable: false, deferred: false, validated: true,
      };
    }
    for (const check of Object.values(table.checkConstraints)) {
      constraints[check.name] = {
        kind: "c", expression: normalizeExpression(check.value, table.name),
        noInherit: false, deferrable: false, deferred: false, validated: true,
      };
    }
    for (const index of Object.values(table.indexes)) {
      if (Object.keys(index.with ?? {}).length || index.columns.some((column) => column.opclass)) {
        throw new Error("Index storage parameters/opclasses require extending the drift check before release.");
      }
      indexes[index.name] = {
        unique: index.isUnique, method: index.method, valid: true, ready: true,
        nullsNotDistinct: false, include: [], storageParameters: [],
        columns: index.columns.map((column) => ({
          expression: normalizeExpression(column.isExpression ? column.expression : `"${column.expression.replaceAll('"', '""')}"`, table.name),
          asc: column.asc, nulls: column.nulls,
          defaultOpclass: true, defaultCollation: true,
        })),
        predicate: normalizeExpression(index.where, table.name),
      };
    }
    // PostgreSQL truncates generated identifiers to 63 UTF-8 bytes, including
    // several existing Drizzle-generated FK names. Detect collisions explicitly.
    function databaseNames(objects) {
      const result = Object.create(null);
      for (const [name, value] of Object.entries(objects)) {
        let truncated = "";
        for (const character of name) {
          if (Buffer.byteLength(truncated + character) > 63) break;
          truncated += character;
        }
        if (Object.hasOwn(result, truncated)) throw new Error("Schema identifiers collide after PostgreSQL truncation.");
        result[truncated] = value;
      }
      return result;
    }
    tables[table.name] = {
      columns, constraints: databaseNames(constraints), indexes: databaseNames(indexes),
      rls: table.isRLSEnabled ?? false, forceRls: false,
    };
  }
  if (!Object.keys(tables).length) throw new Error("No Drizzle tables found; refusing an empty comparison.");
  return { tables };
}

export function compareSchemas(expected, actual) {
  const differences = [];
  function compareObjects(kind, table, left, right) {
    for (const name of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      const object = { kind, ...(table ? { table } : {}), name };
      if (!Object.hasOwn(left, name)) differences.push({ ...object, status: "unexpected" });
      else if (!Object.hasOwn(right, name)) differences.push({ ...object, status: "missing" });
      else if (kind === "table") {
        const fields = ["rls", "forceRls"].filter((field) => left[name][field] !== right[name][field]);
        if (fields.length) differences.push({ ...object, status: "changed", fields });
        for (const [child, key] of [["column", "columns"], ["index", "indexes"], ["constraint", "constraints"]]) {
          compareObjects(child, name, left[name][key], right[name][key]);
        }
      } else {
        const fields = [...new Set([...Object.keys(left[name]), ...Object.keys(right[name])])]
          .filter((field) => JSON.stringify(left[name][field]) !== JSON.stringify(right[name][field])).sort();
        if (fields.length) differences.push({ ...object, status: "changed", fields });
      }
    }
  }
  compareObjects("table", null, expected.tables, actual.tables);
  return differences;
}
