---
name: POST used instead of PATCH for partial resource update
description: Using POST for a partial update operation rather than the semantically correct PATCH — flagged in review as a Major API design issue
type: feedback
---

Partial updates to an existing resource (e.g., editing user fields) must use PATCH, not POST. POST implies resource creation. All other update routes in this codebase use PATCH (e.g., `src/app/api/profile/edit/route.ts`).

**Why:** Semantic correctness matters for REST contract clarity and frontend developer expectations. Using POST for mutation deviates from the established project pattern and makes it harder to reason about what an endpoint does.

**How to apply:** Any endpoint that modifies a subset of fields on an existing database row should be PATCH. Only use POST for creation or actions without idempotency guarantees.
