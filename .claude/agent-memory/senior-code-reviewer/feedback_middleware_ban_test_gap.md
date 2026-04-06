---
name: Missing middleware tests for new ban check behavior
description: When adding a new check to src/middleware.ts, corresponding test cases must be added to src/__tests__/middleware.test.ts
type: feedback
---

When new conditional logic is added to `src/middleware.ts`, the middleware test file at `src/__tests__/middleware.test.ts` must be updated with dedicated test cases for the new behavior. Simply updating existing mock user fixtures to include the new field (e.g., `banned_at: null`) is not sufficient — it only prevents regressions in unrelated tests; it does not prove the new logic path works.

**Why:** The ban check in middleware (Task 5) had zero test cases covering the banned user redirect path. The existing tests all pass `banned_at: null` or omit the field entirely, meaning the `if (data?.banned_at)` branch is never exercised in the test suite. Coverage thresholds can still pass because the branch evaluates to `false` on the covered paths — the `true` branch remains untested.

**How to apply:** After any new conditional block added to middleware (e.g., `if (data?.banned_at)`, `if (data?.suspended_until)`), add a `describe` block in `middleware.test.ts` that covers:
1. Banned user on a protected route → redirects to `/auth?error=banned`
2. Banned user on `/auth` → passes through (no redirect loop)
3. Banned user on `/auth/something` (sub-path) → passes through
