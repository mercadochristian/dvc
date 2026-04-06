---
name: Zod v4 API differences
description: This project uses Zod v4 — key API changes from v3 that affect code generation
type: feedback
---

This project uses Zod v4 (`zod@^4.3.6`). The error property on `ZodError` changed:
- v3: `error.errors[0].message`
- v4: `error.issues[0].message`

**Why:** TypeScript type check (`tsc --noEmit`) caught this when `.errors` was used — it does not exist on `ZodError` in v4.

**How to apply:** Always use `.issues` when accessing Zod parse errors. Also note that string validation methods like `z.string('message')` are valid in v4 as shorthand for `.min(1, 'message')`.
