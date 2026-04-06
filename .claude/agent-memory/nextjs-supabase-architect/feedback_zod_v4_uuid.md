---
name: Zod v4 strict UUID validation in tests
description: Zod v4 enforces RFC 4122 compliant UUIDs — simple repeated-digit UUIDs like 11111111-... fail validation
type: feedback
---

Zod v4 uses a strict RFC 4122 UUID regex. UUIDs must have version nibble [1-8] in the third segment and variant nibble [89abAB] in the fourth segment.

Common test UUIDs like `11111111-1111-1111-1111-111111111111`, `22222222-2222-2222-2222-222222222222`, and `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` **all fail** Zod v4 UUID validation.

**Use this validated test UUID pattern:**
```
a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a000  # SCH_ID
a0a0a0a1-a0a0-4a0a-8a0a-a0a0a0a0a001  # USER1_ID
a0a0a0a2-a0a0-4a0a-8a0a-a0a0a0a0a002  # USER2_ID
...etc
```

Special cases `00000000-0000-0000-0000-000000000000` and `ffffffff-ffff-ffff-ffff-ffffffffffff` are also valid.

**Why:** Zod v4 tightened UUID validation to RFC 4122 spec compliance. Failing to use valid UUIDs causes Zod schema validation to fail early, making every route test return `{ error: 'Invalid request body' }` regardless of mock setup.

**How to apply:** Any time test data includes UUIDs that go through Zod schema parsing (e.g., schedule_id, user_id in registration schemas), use the `a0a0a0aX-a0a0-4a0a-8a0a-a0a0a0a0a0XX` pattern.
