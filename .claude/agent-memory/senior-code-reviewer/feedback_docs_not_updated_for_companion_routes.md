---
name: Docs not updated for companion routes (e.g., ban/unban pairs)
description: When a feature spans paired routes (ban + unban, create + delete), the Feature Log in CODEBASE.md and FUNCTIONAL.md is sometimes updated for the first route but not the second
type: feedback
---

When implementing paired or companion routes (e.g., ban + unban, create + delete), docs are sometimes updated for the first route in a separate commit but the second route's commit omits the doc updates. Flagged for the unban route — the ban route had a Feature Log entry, the unban route did not.

**Why:** CLAUDE.md workflow step 5 requires both docs to be updated and a Feature Log row added for *every* new feature. The implementer may assume one row covers both.

**How to apply:** On every review of a new route, check the commit's changed files for `docs/CODEBASE.md` and `docs/FUNCTIONAL.md`. If missing, flag as Major. Each route (even a companion to an existing one) must have its own Feature Log row.
