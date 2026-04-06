# Next.js Rules

## Scope
Applied to: `src/app/**/page.tsx`, `src/app/**/layout.tsx`, `src/app/**/route.ts`, `src/middleware.ts`, `src/components/**`

## Server vs Client Components

**Default to Server Components.** Only add `'use client'` when the component needs:
- React hooks (`useState`, `useEffect`, `useContext`, custom hooks)
- Browser event handlers (`onClick`, `onChange`, `onSubmit`)
- Browser-only APIs (`window`, `navigator`, `document`)
- Real-time subscriptions or WebSocket connections

**Page files are always Server Components.** Never add `'use client'` to a `page.tsx`. If a page needs interactivity, extract a `*-client.tsx` file and import it:

```
// ✅ Established pattern
src/app/admin/payments/page.tsx          ← Server Component: fetches data, no 'use client'
src/app/admin/payments/payments-client.tsx ← Client Component: receives data as props, handles UI

// ❌ Wrong
src/app/admin/payments/page.tsx with 'use client' at the top
```

`layout.tsx` files should not have `'use client'` unless they wrap an auth context provider. `AppShell`-wrapping layouts do not need the directive.

## Data Fetching Strategy

Use this hierarchy — do not skip levels:

1. **Server Component fetch** (`page.tsx`): Fetch initial page data using `createClient()` or `createServiceClient()`. Pass as props to a Client Component. This is the default for all page-level data.

2. **Client-side fetch** (in a Client Component): Use only when data must refresh based on user interaction (e.g., filtering, search). Use `fetch('/api/...')` or a custom hook.

3. **API route** (`src/app/api/**/route.ts`): Use when the operation is a write (POST/PATCH/DELETE), requires service-role access from the browser, or is triggered by a user action in a Client Component.

**Never call `createServiceClient()` inside a Client Component** — it would expose the service role key to the browser bundle. Browser-triggered privileged operations must go through an API route.

## API Route Structure

Every API route handler must follow this order:

```ts
export async function POST(request: NextRequest) {
  // 1. Parse body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // 2. Validate with Zod schema (import from @/lib/validations/)
  const parsed = mySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  // 3. Authenticate with createClient() — respects RLS
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 4. Authorize — check role from DB, not from request body
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 5. Execute with createServiceClient() if privileged
  const service = createServiceClient()
  const { data, error } = await service.from('...').insert({ ... })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 6. Return success
  return NextResponse.json(data, { status: 201 })
}
```

Always return `NextResponse.json(...)` on both success and failure — never throw unhandled errors out of route handlers.

## Middleware Scope (`src/middleware.ts`)

Middleware handles:
- Session refresh (always call `updateSession` before any early return)
- Authentication redirects (unauthenticated → `/auth`)
- Role-based page access guards (`ROLE_PROTECTED_PAGES`)

Middleware must **not**:
- Perform business logic
- Call external APIs other than Supabase auth
- Read request body

`PUBLIC_ROUTES` and `PROFILE_CHECK_EXEMPT` in `src/middleware.ts` are the single source of truth for route access. When adding a new public route, update these arrays — do not add route-level auth checks that duplicate middleware logic.

`ROLE_PROTECTED_PAGES` maps dashboard paths to required roles. New role-protected pages must be added to this map.

## Cache Behavior

- Server Component data is cached by default in Next.js 15.
- Call `revalidatePath('/path/to/page')` in API route handlers after mutations to purge the cache for affected pages.
- To opt a Server Component out of caching entirely: add `export const dynamic = 'force-dynamic'` at the top of the file.
- Do not use `unstable_cache` without documenting the revalidation strategy in a comment.
