---
name: Local type duplication anti-pattern
description: Permission/utility files have defined local UserRole types instead of importing from src/types/index.ts, causing drift risk
type: feedback
---

Recurring pattern: utility files in `src/lib/` define local `type UserRole = ...` inline instead of importing from `src/types/index.ts`. This was flagged in `src/lib/permissions/user-editing.ts`.

**Why:** The canonical `UserRole` is exported from `src/types/index.ts` (derived from the DB enum). A locally duplicated type can silently diverge — for example, `super_admin` exists in the users table row type but was missing from the `user_role` DB enum, and the local copy masked this inconsistency.

**How to apply:** Any file in `src/lib/` that needs role or DB enum types must import from `src/types/index.ts`. Flag local re-declarations of types that already exist in the type system.
