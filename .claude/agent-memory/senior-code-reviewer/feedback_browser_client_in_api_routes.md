---
name: Browser Supabase client used in API route handlers
description: API route handlers import createClient() from lib/supabase/client (browser) instead of lib/supabase/server — a critical misuse flagged in review
type: feedback
---

Never import `createClient` from `@/lib/supabase/client` in an API route handler. That exports `createBrowserClient` (meant for React client components). API routes must use `createClient` from `@/lib/supabase/server`, which reads cookies via Next.js `cookies()` and properly propagates the authenticated session server-side.

**Why:** The browser client uses the anon key and has no access to the request cookies, so `supabase.auth.getUser()` will always return `null` for any real request — effectively making authentication always fail or always pass depending on the environment. Past reviews: `src/app/api/users/[userId]/route.ts` line 3.

**How to apply:** Whenever reviewing or writing an API route handler (any file under `src/app/api/`), verify the auth check uses `await createClient()` from `@/lib/supabase/server`, not the browser client. Flag immediately as Critical if wrong.
