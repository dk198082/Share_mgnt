---
name: Existing database CHECK constraints
description: A schema-push limitation relevant when expanding certificate status values.
---
Do not assume a successful Drizzle schema push updates the expression of an existing named PostgreSQL CHECK constraint.

**Why:** Adding Partially Transferred to the schema's certificate status constraint passed schema push, but the database retained the old expression and rejected real partial transfers. Database-backed tests exposed the mismatch.

**How to apply:** When expanding an existing constrained value set, inspect the live constraint definition and verify a representative write in isolated tests. If development still has the old expression, replace that constraint transactionally without deleting data. Follow managed publication rules for production schema changes; never add startup-time DDL.

For schema-comparison work, use an independent PostgreSQL-created schema as a
test baseline rather than relying only on mocked catalog fixtures.

**Why:** Mock metadata can agree with the expected model while both miss
PostgreSQL's real deparser and identifier behavior. That can make an unchanged
database appear to have drift, obscuring actual missing protections.

**How to apply:** Exercise the comparison on a disposable database with the
supported PostgreSQL version. Keep equivalence rules conservative: a failed
comparison is safer than removing meaningful expression differences to force
a match.
