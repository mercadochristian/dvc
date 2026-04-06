# Supabase Rules

## Scope
Applied to: `src/lib/supabase/**`, `src/app/api/**/route.ts`, `src/lib/dashboard/**`, `src/middleware.ts`, `src/app/**/page.tsx`

## Client Selection

**This is a security decision, not a preference.** Choose the wrong client and you either expose data or bypass access controls.

| Client | Import path | When to use |
|--------|-------------|-------------|
| `createClient()` (server) | `@/lib/supabase/server` | Server Components (`page.tsx`, `layout.tsx`), API route identity checks. Reads session cookies, **respects RLS**. |
| `createClient()` (browser) | `@/lib/supabase/client` | Client Components (`'use client'`). Browser-initiated queries. **Respects RLS** via anon key. |
| `createServiceClient()` | `@/lib/supabase/service` | Server-side only. Admin operations, writing records on behalf of another user, system-level mutations. **Bypasses RLS**. |

**Decision rule:** If the query writes data belonging to a user other than the caller → use `createServiceClient()`. Otherwise use `createClient()` (server).

**The standard two-client pattern for API routes:**
```ts
// 1. Authenticate the caller — respects RLS, confirms identity
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

// 2. Privileged operation — bypasses RLS
const service = createServiceClient()
await service.from('registrations').insert({ ... })
```

**Never** import `createServiceClient()` in a Client Component — it would expose the service role key to the browser bundle.

**Never** use `SUPABASE_SERVICE_ROLE_KEY` in any `NEXT_PUBLIC_` variable.

## Result Handling

Always destructure `{ data, error }` and check `error` before using `data`:

```ts
// ✅ Correct
const { data, error } = await supabase.from('users').select('*').single()
if (error) {
  return NextResponse.json({ error: error.message }, { status: 500 })
}
// use data here

// ❌ Wrong — never access result.data without checking error first
const result = await supabase.from('users').select('*').single()
doSomething(result.data)
```

## `.single()` vs `.maybeSingle()`

- Use `.single()` when exactly one row **must** exist — it throws `PGRST116` if 0 rows are returned.
- Use `.maybeSingle()` when 0 rows is a valid outcome — it returns `{ data: null, error: null }` instead of an error.

```ts
// Row must exist (user fetching their own profile)
const { data, error } = await supabase.from('users').select().eq('id', userId).single()

// Row may not exist (checking if user already registered)
const { data } = await supabase.from('registrations').select().eq('user_id', userId).maybeSingle()
if (!data) { /* not registered yet */ }
```

## Row Level Security (RLS)

- RLS **must be enabled** on all tables that contain user data. Never disable RLS as a debugging shortcut.
- Every new table migration must include `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and the required policies before any application code queries it.
- Policy changes require a new migration — never edit policies manually in the Supabase dashboard.

## Auth Session Management

- Use `supabase.auth.getUser()` for server-side identity checks — it re-validates with Supabase's servers.
- Do **not** use `supabase.auth.getSession()` for auth checks in API routes — the session is not re-validated and can be spoofed.
- Never store auth tokens in `localStorage` or `sessionStorage` manually. `@supabase/ssr` manages cookie-based session storage automatically.
