---
name: Testing Infrastructure
description: Vitest test setup, coverage thresholds, mock pattern, and test file locations introduced in Phase 1-3 testing work
type: project
---

Vitest test suite added (Phase 1–3, 2026-03-19). Tests live under `src/**/__tests__/**/*.test.ts`.

Global mocks in `src/__tests__/setup.ts` auto-mock `@/lib/supabase/service`, `@/lib/supabase/server`, `@/lib/supabase/middleware`, `@/lib/logger`, and `next/headers`. Individual tests configure these with `vi.mocked(...)`.

Coverage thresholds (v8 provider): lines 90%, functions 90%, branches 85%.

**Why:** Ensure API routes, middleware, and utility logic are verified before merge, particularly for complex flows like guest user creation and group registration validation.

**How to apply:** When documenting new features, check for corresponding `__tests__` directories. Coverage is enforced only on files explicitly listed in `vitest.config.mts` `coverage.include`.
