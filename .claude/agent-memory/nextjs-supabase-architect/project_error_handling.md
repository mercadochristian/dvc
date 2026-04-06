---
name: Error Handling Infrastructure
description: How errors are standardised, surfaced, and logged across client components in this project
type: project
---

Error handling is centralised through three new files added 2026-03-18:

**`src/lib/errors/messages.ts`**
- `getUserFriendlyMessage(error)` maps Supabase PostgREST codes, Auth codes, Storage errors, and network failures to user-safe strings
- `FALLBACK_ERROR_MESSAGE` is the generic fallback
- Never expose raw error objects in toast descriptions — always call `getUserFriendlyMessage()` first

**`src/lib/hooks/useSupabaseQuery.ts`**
- `useSupabaseQuery<T>({ context, showToast? })` — generic hook wrapping Supabase queries
- Returns `{ data, error, isLoading, execute }`
- Handles toast + console.error automatically
- Use for new query hooks; existing components use inline error handling

**`src/components/error-boundary.tsx`**
- `ErrorBoundary` class component — wraps subtrees that might throw during render
- Default fallback: "Something went wrong" card with "Refresh Page" + "Try Again" buttons
- Accepts custom `fallback` render prop

**Convention for client components:**
- `toast.error('Failed to X', { description: getUserFriendlyMessage(error) })` on mutation failures
- `console.error('[ComponentName] context:', error)` alongside every toast — keeps technical details out of UI
- Add an `errorMessage` state + retry button for critical data-fetch paths (e.g. dashboard)
- Non-critical fetches (e.g. user registrations in PublicCalendar) can log-only without showing a toast

**Why:** Prior code swallowed errors silently or showed raw messages. This pattern ensures users always get actionable feedback and developers always get technical context in the console.

**How to apply:** On any new Supabase query in a client component, wrap in try/catch or check `.error` and call both `console.error('[Tag] msg:', err)` and `toast.error('...', { description: getUserFriendlyMessage(err) })`.
