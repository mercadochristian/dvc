# Memory Index — Volleyball Reservation App

## Project Context
- [project_overview.md](project_overview.md) — Stack, roles, and key conventions for this project

## Patterns & Gotchas
- [feedback_zod_v4_api.md](feedback_zod_v4_api.md) — Zod v4 uses `.issues` not `.errors` on ZodError
- [feedback_zod_v4_uuid.md](feedback_zod_v4_uuid.md) — Zod v4 strict RFC 4122 UUIDs: use a0a0a0aX-a0a0-4a0a-8a0a-... pattern in tests, NOT 11111111-... style
- [feedback_supabase_mock_pattern.md](feedback_supabase_mock_pattern.md) — Per-table builders required for multi-table route tests; don't re-declare vi.mock in test files
- [project_error_handling.md](project_error_handling.md) — Error handling infrastructure: getUserFriendlyMessage, useSupabaseQuery, ErrorBoundary, and the console+toast convention
