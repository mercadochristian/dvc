---
name: Duplicate vi.mock declarations in test files
description: Test files must not re-declare vi.mock for modules already auto-mocked in setup.ts; doing so can conflict with the global setup
type: feedback
---

The global setup file (`src/__tests__/setup.ts`) already auto-mocks `@/lib/supabase/service`, `@/lib/supabase/server`, `@/lib/logger`, and `next/cache`. Individual test files must NOT re-declare `vi.mock()` for these modules unless they need to override the default behavior with a different mock implementation.

**Why:** Re-declaring the same mock in a test file is redundant and can lead to ordering/precedence confusion — the global mock may win or the local one may, depending on Vitest's resolution order. The setup.ts file is the single source of truth for which modules are mocked globally.

**How to apply:** When reviewing API route test files, flag any `vi.mock('@/lib/supabase/service')`, `vi.mock('@/lib/supabase/server')`, `vi.mock('@/lib/logger')`, or `vi.mock('next/cache', ...)` declarations that simply re-declare what setup.ts already provides. If the test truly needs different behavior, the duplication is acceptable with a comment explaining why.
