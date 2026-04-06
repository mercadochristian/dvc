# Code Review Rules

## Scope
Applied when: completing any feature, before merging to main, when explicitly triggered.
`alwaysApply: false` — invoked on-demand via the `senior-code-reviewer` agent.

## When a Code Review Is Required

**Always required:**
- After implementing any new API route or modifying an existing route's business logic
- After any change to `src/middleware.ts`
- After any Supabase RLS policy change or new migration
- After any change to authentication or authorization logic
- After completing a feature that spans more than one file

**Not required:**
- Documentation-only changes (`.md` files)
- CSS/token-only changes (no logic)
- Test-only changes (covered by test review in `testing.md`)

## What the Reviewer Must Check

### Security (Blockers — must fix before proceeding)
- [ ] `createServiceClient()` is not used where `createClient()` would suffice (principle of least privilege — see `supabase.md`)
- [ ] No user-supplied data reaches a Supabase query without Zod validation upstream
- [ ] API routes authenticate before performing any data operation
- [ ] Admin-only routes check role from the **database** — not from the request body, a header, or a cookie value

### Correctness (Required — fix in same session)
- [ ] Every `{ data, error }` destructure from Supabase checks `error` before using `data`
- [ ] `.single()` is used only when exactly one row is guaranteed; `.maybeSingle()` is used when 0 rows is valid
- [ ] All `async` functions that can fail have try-catch or explicitly propagate errors
- [ ] `revalidatePath()` is called after mutations that affect a cached page

### Code Quality (Required)
- [ ] No inline `buildMockServiceClient`, `createTableBuilder`, or similar factories in test files — use `@/__tests__/helpers/supabase-mock`
- [ ] No hardcoded color values (`#hex`, `rgb()`, `oklch()`) in component files — use design tokens from `frontend.md`
- [ ] No `console.log` in committed code — use `logActivity`, `logError`, or `logWarn` from `@/lib/logger`
- [ ] No `any` type casts without a comment explaining why it is unavoidable

### Tests (Required)
- [ ] Every new or modified exported function/route has at least one test
- [ ] New API routes have tests for: 400/422 (bad input), 401 (unauthenticated), 403 (unauthorized), 200/201 (happy path), 500 (DB error)
- [ ] New API routes are added to `vitest.config.mts` `coverage.include`

## How Findings Are Reported

Findings must be categorized:

**Blocker** — Security issues, missing auth checks, bypassed RLS, crashes. Must be resolved before moving to the next task.

**Required** — Missing error handling, wrong client choice, test gaps. Fix in the same session.

**Suggestion** — Naming, refactoring opportunities, performance improvements. Optional.

The reviewer lists all findings by category, then the implementing agent resolves Blockers and Required items before marking the task complete.
