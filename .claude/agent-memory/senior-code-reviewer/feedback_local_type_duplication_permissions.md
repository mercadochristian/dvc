---
name: Local UserRole redefinition in permissions module
description: src/lib/permissions/user-editing.ts redefines UserRole locally instead of importing from src/types/index.ts
type: feedback
---

`src/lib/permissions/user-editing.ts` defines its own `type UserRole = 'super_admin' | 'admin' | 'facilitator' | 'player'` at line 1 rather than importing from `@/types`. This is a repeat of the pattern flagged in `feedback_local_type_duplication.md`.

**Why:** All utility files in `src/lib/` must import shared domain types from `src/types/index.ts`. Local redefinitions diverge silently when the canonical enum is updated.

**How to apply:** Flag any `type UserRole = ...` or `type SkillLevel = ...` declarations inside `src/lib/` as a duplication violation. The fix is always `import type { UserRole } from '@/types'`.
