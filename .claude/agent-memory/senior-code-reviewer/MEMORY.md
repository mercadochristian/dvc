# Memory Index — Senior Code Reviewer

## Recurring Anti-Patterns
- [feedback_hardcoded_colors.md](feedback_hardcoded_colors.md) — Hard-coded hex/utility colors in themed panels bypass the CSS token system
- [feedback_back_button_text.md](feedback_back_button_text.md) — Icon-only back button in mobile nav missing visible text label (violates project rule)
- [feedback_local_type_duplication.md](feedback_local_type_duplication.md) — Utility files in src/lib/ must import UserRole from src/types/index.ts, not redefine it locally
- [feedback_local_type_duplication_permissions.md](feedback_local_type_duplication_permissions.md) — Confirmed repeat: src/lib/permissions/user-editing.ts redefines UserRole locally (line 1)
- [feedback_browser_client_in_api_routes.md](feedback_browser_client_in_api_routes.md) — API routes must use lib/supabase/server createClient(), never the browser client
- [feedback_post_not_patch_for_updates.md](feedback_post_not_patch_for_updates.md) — Partial resource updates must use PATCH, not POST
- [feedback_duplicate_test_files.md](feedback_duplicate_test_files.md) — Don't have both __tests__/route.test.ts and a sibling route.test.ts for the same route
