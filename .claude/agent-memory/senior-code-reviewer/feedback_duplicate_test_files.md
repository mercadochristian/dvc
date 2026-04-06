---
name: Duplicate test files for the same route
description: Two test files exist for the same API route — one in __tests__/ and one as a sibling .test.ts — flagged in review
type: feedback
---

`src/app/api/users/[userId]/` has both `route.test.ts` (sibling) and `__tests__/route.test.ts`. These cover overlapping cases and will both be picked up by the test runner. Only one location should be used; the project convention is `__tests__/route.test.ts`.

**Why:** Duplicate test files cause confusion about which is authoritative, may result in conflicting mock setups, and bloat the test suite.

**How to apply:** When adding tests to any API route, place them under `__tests__/route.test.ts` relative to the route file. Delete any sibling `.test.ts` files that duplicate coverage.
