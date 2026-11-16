import assert from "node:assert/strict";
import test from "node:test";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ListSettingsAuditQueryParams } from "@workspace/api-zod";
import { loadCentralizedAudit } from "./centralized-audit";
import { loadSettingsAudit } from "../routes/settings-audit";

test("centralized audit reads both histories without changing source records", async t => {
  // Temporary tables shadow real tables on this one transaction/connection.
  // All fixture writes are synthetic and disappear on commit.
  await db.transaction(async tx => {
    await tx.execute(sql`CREATE TEMP TABLE settings_audit (
      id text PRIMARY KEY, actor_id text, actor_name text, action text,
      target_id text, outcome text, changes jsonb, detail text,
      created_at timestamptz, completed_at timestamptz
    ) ON COMMIT DROP`);
    await tx.execute(sql`CREATE TEMP TABLE shareholder_activity (
      id text PRIMARY KEY, shareholder_id text, name text, action text,
      actor text, actor_name text, changes jsonb, created_at timestamptz
    ) ON COMMIT DROP`);
    await tx.execute(sql`INSERT INTO settings_audit VALUES (
      'same-id', 'admin', 'Admin Snapshot', 'Share prices changed', 'prices', 'succeeded',
      '[{"field":"Common price","before":"1","after":"2","protected":false}]', NULL,
      '2026-01-01 12:00:00.000001+00', '2026-01-01 12:00:01+00'
    ), (
      'pending', 'admin', 'Admin Snapshot', 'User invited', 'invitation', 'pending',
      '[]', 'Awaiting confirmation', '2026-01-01 12:00:00.000003+00', NULL
    )`);
    const fixtures = [
      ["same-id", "Shareholder created", "holder-a", "Synthetic Alpha", "[]"],
      ["profile", "Record updated", "holder-a", "Synthetic Alpha",
        '[{"field":"SSN","before":null,"after":"Protected value added","protected":true}]'],
      ["issued", "Certificate C-9 issued · 20 Common shares", "holder-a", "Synthetic Alpha", "[]"],
      ["requested", "Certificate issuance requested · awaiting configured signers", "holder-a", "Synthetic Alpha", "[]"],
      ["sent", "10 Common shares transferred to Synthetic Beta · C-9 → C-10", "holder-a", "Synthetic Alpha", "[]"],
      ["received", "10 Common shares received from Synthetic Alpha · C-9 → C-10", "holder-b", "Synthetic Beta", "[]"],
      ["approved", "Signer approved transfer request synthetic", "holder-a", "Synthetic Alpha", "[]"],
      ["rejected", "Signer rejected issuance request synthetic", "holder-a", "Synthetic Alpha", "[]"],
      ["files", "Supporting files added to transfer C-9 → C-10", "holder-a", "Synthetic Alpha", "[]"],
      ["legacy", "Legacy shareholder record imported", "holder-a", "Synthetic Alpha", null],
    ];
    for (const [id, action, holder, name, changes] of fixtures) {
      await tx.execute(sql`INSERT INTO shareholder_activity VALUES (
        ${id}, ${holder}, ${name}, ${action}, 'employee', ${id === "legacy" ? null : "Employee Snapshot"},
        ${changes}::jsonb, '2026-01-01 12:00:00.000002+00'
      )`);
    }

    await t.test("combines existing records, preserves sources, actor snapshots and outcomes", async () => {
      const page = await loadCentralizedAudit({}, tx);
      assert.equal(page.entries.length, 12);
      assert.equal(new Set(page.entries.map(e => e.id)).size, 12);
      assert.equal(page.entries[0].id, "administration:pending");
      assert.equal(page.entries.at(-1)?.id, "administration:same-id");
      assert.equal(page.entries.find(e => e.id === "administration:pending")?.outcome, "pending");
      assert.equal(page.entries.find(e => e.id === "shareholder:profile")?.actorName, "Employee Snapshot");
      const legacy = page.entries.find(e => e.id === "shareholder:legacy");
      assert.equal(legacy?.detailed, false);
      assert.equal(legacy?.actorName, "Unknown employee");
      assert.deepEqual(legacy?.changes, []);
      assert.equal(page.entries.find(e => e.id === "shareholder:received")?.shareholderId, "holder-b");
      assert.ok(!JSON.stringify(page).includes("/objects/"));
      assert.ok(JSON.stringify(page).includes("Protected value added"));
    });

    await t.test("filters across the full history before pagination", async () => {
      for (const [category, expected] of [
        ["administration", 2], ["shareholders", 3], ["issuance", 2],
        ["transfers", 2], ["approvals", 2], ["documents", 1],
      ] as const) {
        const page = await loadCentralizedAudit({ category }, tx);
        assert.equal(page.entries.length, expected, category);
        assert.ok(page.entries.every(e => e.category === category));
      }
      assert.equal((await loadCentralizedAudit({ search: "synthetic beta" }, tx)).entries.length, 2);
      assert.equal((await loadCentralizedAudit({ category: "issuance", search: "C-9" }, tx)).entries.length, 1);
      assert.equal((await loadCentralizedAudit({ search: "' OR true --" }, tx)).entries.length, 0);
      assert.equal((await loadCentralizedAudit({ search: "%" }, tx)).entries.length, 0);
    });

    await t.test("original settings-only loader and original history rows remain available", async () => {
      const settings = await loadSettingsAudit(undefined, tx);
      assert.equal(settings.entries.length, 2);
      const activity = await tx.execute(sql`SELECT count(*)::int AS count FROM shareholder_activity`);
      assert.equal(activity.rows[0].count, 10);
    });

    await t.test("paginates tied and sub-millisecond timestamps across both sources", async () => {
      await tx.execute(sql`INSERT INTO shareholder_activity
        SELECT 'page-' || lpad(n::text, 3, '0'), 'holder-c', 'Synthetic Gamma', 'Record updated',
          'employee', 'Employee Snapshot', '[]'::jsonb,
          '2026-01-01 12:00:00.000002+00'::timestamptz
        FROM generate_series(1, 65) AS n`);
      const first = await loadCentralizedAudit({}, tx);
      assert.equal(first.entries.length, 50);
      assert.ok(first.nextCursor);
      const second = await loadCentralizedAudit({ before: first.nextCursor! }, tx);
      assert.equal(second.entries.length, 27);
      assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.entries, ...second.entries].map(e => e.id)).size, 77);
      await assert.rejects(loadCentralizedAudit({ before: "shareholder:missing" }, tx), /cursor not found/);
      await assert.rejects(loadCentralizedAudit({ before: "unknown:same-id" }, tx), /cursor not found/);
      // The anchor need not match the active category/search, and old unqualified
      // settings cursors remain accepted. Preserve its original microseconds.
      const oldCursor = await loadCentralizedAudit({ before: "pending" }, tx);
      assert.equal(oldCursor.entries[0].createdAt, "2026-01-01T12:00:00.000Z");
      assert.ok(!oldCursor.entries.some(e => e.id === "administration:pending"));
      assert.equal((await loadCentralizedAudit({
        before: "administration:pending", category: "documents", search: "Supporting",
      }, tx)).entries.length, 1);
      const filtered = await loadCentralizedAudit({ category: "shareholders", search: "Gamma" }, tx);
      const filteredNext = await loadCentralizedAudit({ category: "shareholders", search: "Gamma", before: filtered.nextCursor! }, tx);
      assert.equal(filtered.entries.length, 50);
      assert.equal(filteredNext.entries.length, 15);
    });

    await t.test("preserves literal search, fallback names, and IDs containing colons", async () => {
      await tx.execute(sql`INSERT INTO shareholder_activity VALUES (
        'id:with:colons', 'literal-holder', 'Fictional %_ Holder', 'Record updated',
        'employee', '', NULL, '2026-01-02 00:00:00+00'
      )`);
      const literal = await loadCentralizedAudit({ search: "%_" }, tx);
      assert.equal(literal.entries.length, 1);
      assert.equal(literal.entries[0].id, "shareholder:id:with:colons");
      assert.equal(literal.entries[0].actorName, "Unknown employee");
      assert.equal((await loadCentralizedAudit({
        before: literal.entries[0].id, search: "%_",
      }, tx)).entries.length, 0);
      assert.equal((await loadCentralizedAudit({ search: "Unknown employee" }, tx)).entries.length, 2);
    });

    await t.test("rejects invalid dates and reversed ranges before querying", async () => {
      for (const params of [
        { from: "2026-02-29" }, { to: "2024-02-30" }, { from: "2026-13-01" },
        { to: "0000-01-01" }, { from: "" }, { from: "2026-1-01" },
        { to: "2026-03-08T00:00:00Z" }, { from: "2026-03-09", to: "2026-03-08" },
      ]) {
        await assert.rejects(loadCentralizedAudit(params, tx), { status: 400 });
      }
      assert.equal(ListSettingsAuditQueryParams.safeParse({ from: "not-a-date" }).success, false);
      assert.deepEqual(ListSettingsAuditQueryParams.parse({ from: "2024-02-29", to: "2024-02-29" }),
        { from: "2024-02-29", to: "2024-02-29" });
    });

    await t.test("includes whole UTC days with microsecond precision across both sources", async () => {
      await tx.execute(sql`TRUNCATE pg_temp.settings_audit, pg_temp.shareholder_activity`);
      // DST begins in Los Angeles on this date. Connection timezone and timestamp
      // offsets must not change the UTC calendar boundaries.
      await tx.execute(sql`SET LOCAL TIME ZONE 'America/Los_Angeles'`);
      for (const [id, at] of [
        ["before", "2026-03-07 23:59:59.999999+00"],
        ["start", "2026-03-08 00:00:00+00"],
        ["offset", "2026-03-07 19:00:00-05"],
        ["end", "2026-03-08 23:59:59.999999+00"],
        ["next", "2026-03-09 00:00:00+00"],
      ]) {
        await tx.execute(sql`INSERT INTO settings_audit VALUES (
          ${id}, 'admin', 'Synthetic Admin', 'Share prices changed', 'prices', 'succeeded',
          '[]', NULL, ${at}::timestamptz, '2026-03-08 12:00:00+00'
        )`);
        await tx.execute(sql`INSERT INTO shareholder_activity VALUES (
          ${id}, 'synthetic-holder', 'Synthetic Boundary', 'Record updated',
          'employee', 'Synthetic Employee', '[]', ${at}::timestamptz
        )`);
      }
      const range = { from: "2026-03-08", to: "2026-03-08" };
      const page = await loadCentralizedAudit(range, tx);
      assert.deepEqual(new Set(page.entries.map(e => e.id)), new Set(
        ["administration", "shareholder"].flatMap(source => ["start", "offset", "end"].map(id => `${source}:${id}`)),
      ));
      assert.equal(page.nextCursor, null);
      assert.equal((await loadCentralizedAudit({ from: range.from }, tx)).entries.length, 8);
      assert.equal((await loadCentralizedAudit({ to: range.to }, tx)).entries.length, 8);
      assert.equal((await loadCentralizedAudit({ ...range, category: "administration" }, tx)).entries.length, 3);
      assert.equal((await loadCentralizedAudit({ ...range, search: "Boundary" }, tx)).entries.length, 3);
      assert.equal((await loadCentralizedAudit({ from: "2026-03-10" }, tx)).entries.length, 0);
      // A matching reporting day is older than >50 excluded events. Filtering
      // after LIMIT would incorrectly yield an empty/short first page.
      await tx.execute(sql`INSERT INTO shareholder_activity
        SELECT 'outside-' || n, 'synthetic-holder', 'Synthetic Outside', 'Record updated',
          'employee', 'Synthetic Employee', '[]'::jsonb, '2026-03-10 12:00:00+00'::timestamptz
        FROM generate_series(1, 60) AS n`);
      await tx.execute(sql`INSERT INTO shareholder_activity
        SELECT 'inside-' || n, 'synthetic-holder', 'Synthetic Boundary', 'Record updated',
          'employee', 'Synthetic Employee', '[]'::jsonb, '2026-03-08 12:00:00+00'::timestamptz
        FROM generate_series(1, 60) AS n`);
      const first = await loadCentralizedAudit(range, tx);
      const second = await loadCentralizedAudit({ ...range, before: first.nextCursor! }, tx);
      assert.equal(first.entries.length, 50);
      assert.equal(second.entries.length, 16);
      assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.entries, ...second.entries].map(e => e.id)).size, 66);
      assert.ok([...first.entries, ...second.entries].every(e => !e.id.includes("outside-")));

      await tx.execute(sql`INSERT INTO shareholder_activity VALUES (
        'leap', 'synthetic-holder', 'Synthetic Leap', 'Record updated',
        'employee', 'Synthetic Employee', '[]', '2024-02-29 23:59:59.999999+00'
      ), (
        'leap-next', 'synthetic-holder', 'Synthetic Leap', 'Record updated',
        'employee', 'Synthetic Employee', '[]', '2024-03-01 00:00:00+00'
      )`);
      assert.deepEqual((await loadCentralizedAudit({ from: "2024-02-29", to: "2024-02-29" }, tx))
        .entries.map(e => e.id), ["shareholder:leap"]);
      assert.equal((await loadCentralizedAudit({ from: "9999-12-31", to: "9999-12-31" }, tx)).entries.length, 0);
    });
  });
}).finally(() => pool.end());
