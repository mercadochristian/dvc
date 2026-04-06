---
name: New API routes omitted from vitest coverage.include
description: Recurring pattern where a new API route is implemented but not added to coverage.include in vitest.config.mts, silently excluding it from threshold enforcement
type: feedback
---

New API routes are consistently not added to `coverage.include` in `vitest.config.mts` at the time of implementation. This was flagged for the unban route (`src/app/api/users/[userId]/unban/route.ts`) — the ban route was included but the unban route was not.

**Why:** Without the entry, the 90% line/function and 85% branch thresholds are not enforced against the file. Future regressions in that route will not be caught by the coverage gate.

**How to apply:** On every review of a new API route, check `vitest.config.mts` `coverage.include` for the route's path. Flag as Major if missing. The fix is always to add `'src/app/api/path/to/route.ts'` to the array.
