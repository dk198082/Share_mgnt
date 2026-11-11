# Azure SQL migrations

Add one reviewed, timestamped `.sql` file per change. The migration workflow
was introduced for future Azure schema changes; do not add a full current
schema snapshot or mark one as applied without comparing it to the live Azure
schema first. See `docs/azure-schema-migrations.md` for review gates and apply
instructions.
