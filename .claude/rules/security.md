# Security Rules

## Scope
Applied to `src/api/**`, `src/auth/**`, `src/middleware/**`, `**/routes/**`, and `**/controllers/**`.

## Core Requirements

**Input Validation**
- Validate all user input at the system boundary. Never trust request parameters.
- Use parameterized queries — never concatenate user input into SQL or shell commands.

**Output Sanitization**
- Sanitize output to prevent XSS. Use framework-provided escaping.
- Never expose stack traces, internal paths, or raw database errors in production responses.

**Authentication & Tokens**
- Authentication tokens must be short-lived. Store refresh tokens server-side only.
- Use constant-time comparison for secrets and tokens.
- Rate-limit authentication endpoints.

**Secrets & Logging**
- Never log secrets, tokens, passwords, or PII.
- Avoid logging sensitive information in error messages.

**Headers & CORS**
- Set appropriate CORS, CSP, and security headers.
- Validate origin headers for sensitive operations.

**Data Protection**
- Use HTTPS for all communications containing user data.
- Encrypt sensitive data at rest when applicable.

---

## Project-Specific Security Rules

These rules are derived from `docs/SECURITY.md` — 12 vulnerabilities found in this codebase. Apply them when writing or reviewing any API route, middleware, service function, or UI that handles auth, user data, or resource mutation.

### Authentication: Never Trust the Header Alone (CRITICAL — finding #1)

**Never** treat a non-empty `Authorization` header as proof of identity. Always call `supabase.auth.getUser()` and check the returned `user` object:

```ts
// ❌ Wrong — auth bypass risk
const authHeader = req.headers.get('authorization')
if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
// Never verified the token

// ✅ Correct
const { data: { user }, error } = await serverClient.auth.getUser()
if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
```

### Redirect Validation — No Open Redirects (finding #2)

Never pass a `returnUrl` (or any user-supplied URL) directly to `router.push()` or `NextResponse.redirect()`. Validate that the URL is a safe internal path:

```ts
const isSafeRedirect = (url: string): boolean =>
  url.startsWith('/') && !url.startsWith('//')

const safeUrl = isSafeRedirect(returnUrl) ? returnUrl : '/dashboard'
router.push(safeUrl)
```

This blocks protocol-relative URLs (`//evil.com`), absolute URLs, and path-traversal variants.

### Availability Checks Must Be Atomic (finding #3)

Check-then-insert patterns for shared resources (schedule slots, inventory) are TOCTOU race conditions. The check and insert must be a single atomic operation.

Use a Postgres trigger or RPC function to enforce limits at the database level — do not rely on application-level availability checks before a separate insert.

```sql
-- Enforce in DB, not in application code:
CREATE OR REPLACE FUNCTION check_registration_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM registrations WHERE schedule_id = NEW.schedule_id)
     >= (SELECT max_players FROM schedules WHERE id = NEW.schedule_id) THEN
    RAISE EXCEPTION 'Schedule is full';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Resource Ownership Verification (finding #4)

Before mutating any resource via an ID from the request body, verify the calling user owns that resource. Never skip this check for operations that affect another user's data.

```ts
// Always verify before mutating:
const { data: resource } = await serverClient
  .from('registration_payments')
  .select('id, registrations(user_id)')
  .eq('id', body.resource_id)
  .single()

if (!resource || resource.registrations?.user_id !== authUser.id) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

### Role Scope Checks — Not Just Role Name (finding #5)

When a route allows multiple roles (e.g., admin AND facilitator), each role must have its scope verified, not just its name. A facilitator can only act on schedules they are assigned to.

```ts
if (profile.role === 'facilitator') {
  const { data: assignment } = await serverClient
    .from('schedule_facilitators')
    .select('id')
    .eq('schedule_id', body.schedule_id)
    .eq('user_id', authUser.id)
    .single()

  if (!assignment) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

### No PII in Public Routes (finding #6)

Routes returning personally identifiable information (names, emails, phone numbers) **must require authentication**. When adding a new route, check if it returns any PII before adding it to `PUBLIC_ROUTES` in `src/middleware.ts`. If it returns PII, it must not be public.

### Array Parameter Size Limits (finding #7)

Any route that accepts a list of IDs (comma-separated or array) must enforce a maximum size to prevent unbounded database queries:

```ts
const ids = raw.split(',').map(id => id.trim()).filter(Boolean)
if (ids.length > 50) {
  return NextResponse.json({ error: 'Too many IDs (max 50)' }, { status: 400 })
}
```

### Guest Upsert Must Not Overwrite Real Users (finding #8)

When creating or updating a guest user by email, always check `is_guest === true` before updating. Never overwrite a real (non-guest) user's profile with guest registration data.

```ts
const { data: existing } = await serviceClient.from('users').select('is_guest').eq('email', email).single()
if (existing && !existing.is_guest) {
  return { userId: existing.id, wasCreated: false }  // Use existing real user; don't overwrite
}
```

### Search Endpoints Must Restrict by Role (finding #9)

Any search endpoint returning user data (email, name, phone) must verify the caller is an admin, super_admin, or facilitator. Players must not be able to enumerate other users.

### Log Endpoints: Allowlist Actions, Limit Message Length (finding #10)

Log/audit endpoints must validate the `action` field against a hardcoded allowlist and cap `message` length. Free-form strings allow log injection and audit trail pollution.

```ts
const ALLOWED_LOG_ACTIONS = ['auth.sign_in', 'registration.created', /* ... */]
if (!ALLOWED_LOG_ACTIONS.includes(action)) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
if (!message || message.length > 500) return NextResponse.json({ error: 'Invalid message' }, { status: 400 })
```

### Middleware Must Fail Closed (finding #11)

The `catch` block in `src/middleware.ts` must **never** call `NextResponse.next()`. On any error, redirect to an error page. Passing requests through on auth failure is a full auth bypass:

```ts
} catch (err) {
  void logError('middleware.unhandled', err)
  return NextResponse.redirect(new URL('/auth?error=service_unavailable', request.url))
}
```

### Document All Required Env Vars in `.env.example` (finding #12)

Every environment variable referenced in source code must have an entry in `.env.example` with a placeholder value and a comment. Undocumented env vars cause silent runtime failures.

When adding a new env var: update `.env.example` in the same commit.
