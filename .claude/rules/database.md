# Database Rules

## Scope
Applied to database migrations and schema changes.

## Core Principles

**Migration Safety**
- Never modify an existing migration — create new migrations instead, as existing ones may have already executed in production environments.
- Migration filenames are ordered by timestamp prefix — new migrations go at the end.
- Test migrations bidirectionally before committing to the codebase.

**Schema Changes**
- Avoid raw SQL when your ORM/migration tool offers native methods for the operation.
- Add indexes in their own migration, not bundled with schema changes — easier to rollback independently.
- Confirm data is genuinely obsolete before removing columns or tables.

**Reversibility**
- Every migration requires reversibility with both forward and rollback implementations.
- Ensure the rollback plan works before deploying a migration.
- Document any assumptions about data state in migration comments.

**Data Management**
- Never seed production data in migration files — use dedicated seed files.
- Use separate migration and seed processes.
- Document any data transformations or cleanup operations.

**Testing & Validation**
- Run migrations against a test database that mirrors production schema.
- Verify both the forward and backward migrations work correctly.
- Test with realistic data volumes when possible.
