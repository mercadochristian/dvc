---
name: Supabase mock pattern for routes with multiple table queries
description: Per-table query builders required when routes call .from() on multiple different tables
type: feedback
---

The shared query builder in `createMockServerClient()` / `createMockServiceClient()` (in `src/__tests__/helpers/supabase-mock.ts`) returns the **same builder instance** for every `.from(tableName)` call. This causes two problems when routes query multiple tables:

1. `.single.mockResolvedValueOnce(...)` calls queue up on one shared mock — ordering becomes unpredictable when the route calls `.from('users').single()` for auth check and again for player lookup.
2. Setting `(client.from('registrations') as any).then = vi.fn(...)` overwrites the **shared** builder's `.then`, affecting all tables.

**Solution: per-table builder factory inside each test file.**

```ts
function buildMockClients() {
  const serverTables: Record<string, any> = {
    users: createTableBuilder(),
    registrations: createTableBuilder(),
    teams: createTableBuilder(),
    team_members: createTableBuilder(),
  }
  const serverClient = {
    from: vi.fn((table: string) => serverTables[table] ?? createTableBuilder()),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  }
  // ... same for serviceClient with serviceTables
}
```

Then in tests: `tables.server.users.single.mockResolvedValueOnce(...)` and `tables.server.registrations.then = vi.fn(...)` are fully independent.

**Why:** The helper's single shared builder was designed for simple routes with one table. Multi-table routes need per-table isolation to chain `.mockResolvedValueOnce` calls in the correct order.

**How to apply:** Any time a route under test calls `.from()` on more than one table, use the per-table `buildMockClients()` pattern instead of the shared helpers from `supabase-mock.ts`.

**Also note:** Do NOT redeclare `vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))` in test files — the global `src/__tests__/setup.ts` already auto-mocks it. Just use `await import('@/lib/supabase/server')` inside each test body and call `vi.mocked(createClient).mockResolvedValue(...)`.
