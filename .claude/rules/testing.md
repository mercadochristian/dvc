# Testing Rules

## Scope
Applied globally with `alwaysApply: true`.

## Core Testing Principles

**Behavior Over Implementation**
- Write tests that verify behavior, not implementation details.
- One assertion per test. If the name needs "and", split it.
- Never `expect(true)` or assert a mock was called without checking its arguments.

**Test Structure**
- Test names describe behavior: `should return empty array when input is empty`, not `test1`.
- Arrange-Act-Assert structure. No logic (if/loops) in tests.
- Use consistent test naming patterns for readability.

**Mocking & Isolation**
- Prefer real implementations over mocks. Only mock at system boundaries (network, filesystem, clock).
- When mocking, verify the mock's arguments and return values, not just that it was called.

**Feedback & Debugging**
- Run the specific test file after changes, not the full suite — faster feedback.
- If a test is flaky, fix or delete it. Never retry to make it pass.
- Include clear error messages to help identify why tests fail.

**Test Coverage**
- Test both happy paths and error cases.
- Test edge cases (empty inputs, boundary values, null/undefined).
- Test integration points thoroughly (API calls, database interactions).

---

## Test Stack

- **Framework:** Vitest 4.x with jsdom environment (configured in `vitest.config.mts`)
- **Component testing:** `@testing-library/react` + `@testing-library/user-event`
- **DOM matchers:** `@testing-library/jest-dom/vitest` — auto-imported via `src/__tests__/setup.ts` (do not re-import in test files)
- **Environment:** `jsdom` globally. Individual test files that need a different environment may add `// @vitest-environment node` at the top.

## File Location Convention

- **Unit tests:** `src/**/__tests__/**/*.test.{ts,tsx}` — co-located with the code under test.
  - Example: `src/app/api/profile/complete/__tests__/route.test.ts`
- **Integration tests:** Same `__tests__` directory, named `*.integration.test.{ts,tsx}`.
  - Example: `src/app/dashboard/registrations/__tests__/registrations-dashboard.integration.test.tsx`
- **Cross-cutting concerns:** `src/__tests__/middleware.test.ts` — root-level tests for root-level files only.
- Do **not** place test files beside source files without a `__tests__` subdirectory (e.g., `route.test.ts` alongside `route.ts` is the legacy pattern — do not replicate it).
- Do **not** mix unit and integration tests in the same file.

## Mock Helpers — Centralized Pattern Only

Import from `@/__tests__/helpers/` — never define mock factories inline in test files.

```ts
import { createMockServiceClient } from '@/__tests__/helpers/supabase-mock'
import { createMockRequest } from '@/__tests__/helpers/next-mock'
import { createServiceClient } from '@/lib/supabase/service'

// The global setup (src/__tests__/setup.ts) auto-mocks these modules:
// - @/lib/supabase/service
// - @/lib/supabase/server
// - @/lib/supabase/middleware
// - @/lib/logger
// Do NOT re-declare vi.mock() for these in individual test files unless overriding behavior.

describe('POST /api/example', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const client = createMockServiceClient()
    vi.mocked(createServiceClient).mockReturnValue(client as any)
  })

  it('should return 401 when user is not authenticated', async () => {
    const request = createMockRequest({ method: 'POST', body: {} })
    const response = await POST(request)
    expect(response.status).toBe(401)
  })
})
```

**Do not use** `buildMockServiceClient()`, `createTableBuilder()`, or similar inline factory functions. Three test files (`admin/register`, `admin/registrations`, `register/group`) still use this pattern — when modifying those files, migrate them to `createMockServiceClient` from `@/__tests__/helpers/supabase-mock`.

## Unit vs Integration Distinction

| Type | Scope | All deps mocked? | File suffix |
|------|-------|-----------------|-------------|
| Unit | One function or component in isolation | Yes (Supabase, router, logger) | `.test.{ts,tsx}` |
| Integration | Full component tree with real child components | External only (Supabase, fetch) | `.integration.test.{ts,tsx}` |

## Coverage

Thresholds enforced by `vitest.config.mts`: **90% lines, 90% functions, 85% branches**.

Coverage is measured only for files listed in `vitest.config.mts` `coverage.include`. When adding a new utility, hook, or API route that contains core business logic, add it to that list. New API routes in `src/app/api/**` must be added to `coverage.include`.

## Required Test Cases for API Routes

Every new API route must have tests covering:

| Scenario | Expected status |
|----------|----------------|
| Missing or invalid request body | 400 or 422 |
| Unauthenticated request | 401 |
| Authenticated but wrong role | 403 |
| Happy path | 200 or 201 |
| Database error | 500 |
