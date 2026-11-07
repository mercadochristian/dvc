# M1 real-service acceptance coverage

Christian approved this M1 coverage on November 4, 2026. Run through `npm run test:e2e` only after the dedicated stack passes the infrastructure preflight and the reviewed candidate is cleared for QA. See `scripts/e2e/README.md` for external configuration and artifact paths.

The suite uses one worker and no retries. It creates an owned synthetic organization, venue, game, demo-only payment method and confirmed local Auth account. The normal app, real Postgres/REST, real GoTrue and private Storage are exercised; no successful application responses are mocked.

- Guest browser: explicit historical holding-booking fixture is seeded; the actual My bookings payment resume and receipt upload persist a legacy reservation; reload retains access; uploaded bytes match independent Storage and application reads; unrelated guest/public access is denied.
- Authenticated Player: supported local password grant supplies genuine GoTrue tokens to the normal encrypted application session; identity/role checks remain active; own-booking access succeeds, staff access is denied, and logout removes ownership access.
- Teardown: deletes only the owned organization data, receipt objects and Auth account; independently confirms object not-found, zero fixture rows and preserved baseline organizations. Existing operational rate-limit rows are preserved.

These retained M1 cases assert **historical payment-pending compatibility**. The retired public `booking.hold` endpoint is never used to create new registrations. New group/combined-checkout/automatic-approval behavior is accepted only by the separate M3/M4 cases. Google sign-in/callback, staff-allowed actions and live email delivery remain outside this local substitute. Password accounts are never given fabricated Google identities.

Desktop/mobile screenshots are evidence for inspection, not a visual acceptance verdict. No trace, video or authentication state is retained. Fixtures contain no real people, credentials or payment details. Configuration/setup failures must be reported separately from product failures, and retries require a diagnosed change rather than repeated runs until green.

## M2 Games coverage

Christian approved M2-01–08 in `docs/GAME_FLOW_SPEC.md`. `m2-games.spec.ts` adds eight cases using the same dedicated real services, supported local Player authentication and exact-owned cleanup. Its optional fixture contains three same-day games (including simultaneous venues), a next-week game and one synthetic reserved player with private profile/contact fields for redaction checks. Historical M1 setup is explicit; legacy pending/private-receipt assertions remain intact.

Coverage checks chronological views, preserved filters, real capacity/effective prices, redacted public roster, correct Details/registration targeting and keyboard focus, unique selection across layouts/weeks without new holds, genuine offline recovery, delayed real-request loading, stale-roster race protection, selection-to-details focus restoration, last off-week selection removal/focus recovery, desktop/mobile evidence and absent contact links when no URLs are configured. Delayed requests continue to the actual application; successful responses are not mocked.

Staff-allowed and More actions interactions remain **BLOCKED** on a supported genuine Google OAuth strategy. Configured contact-link rendering needs supplied URLs and a reviewed environment; the default isolated environment intentionally clears them. Combined checkout, participant options and payment approval belong to M3/M4. Screenshots alone do not establish UI/UX acceptance. Test creation is separate from execution: report each actual reviewed run and its candidate, cleanup and limitations.


## M3/M4 registration and combined checkout

Coverage REG-01–04, CHK-01–06 and REG-UX is approved in the canonical spec. New test source is prepared separately from actual execution. `m3-m4-checkout.spec.ts` uses actual app APIs, real Auth/REST and private Storage; `m3-m4-browser.spec.ts` adds real browser forms, native Web Locks with two pages sharing an initially empty cookie jar, delayed actual requests, dismissal/reopen, unsupported-browser failure, profile isolation and unknown-result recovery. Successful application responses are never fabricated. Response-drop tests first execute `route.fetch()` against the actual app and independently observe the committed record/receipt before aborting only delivery to the browser.

`checkout-harness.ts` gives each case an exact-owned synthetic organization lifecycle. A schema probe rejects an unupgraded QA stack before fixture creation. Operational rate limits are preserved across these cases. A read-only, case-budgeted gate waits for the actual 600-second write window before any seeding; it never resets a bucket, rotates a secret or disables the guard. Setup may take up to ten minutes; its explicit timeout and recorded wait do not weaken behavior assertions.

Approved failure injection is implemented in `checkout-fault.ts` and executes only during its specific reviewed cases: exact dedicated preflight, exact-owned holding checkout and upgraded schema; fresh per-invocation trigger/function names and provenance comments on both objects, created in one transaction with a zero catalog baseline; `checkout_receipts` failure restricted to that checkout UUID, or `storage.objects` failure restricted to its actual private bucket/path prefix. DDL/ownership/recovery manifests are written outside Git with mode0600. Finally proves exact schema/table/function-OID relationships, original body, the kind-derived existing actor/owner and both provenance markers, obtains the retained function DDL lock through a proven same-owner no-op, revalidates, then drops only the proven objects and verifies catalog absence. Missing/mismatched provenance preserves the objects and blocks acceptance; a name, baseline or installed flag is never deletion authority. Database faults use the existing local `postgres` actor; Storage faults use the existing local `supabase_admin` maintenance actor for the entire invocation. The kind determines this allowlist internally; no caller-selected roles, SET ROLE, grants, passwords or table ownership changes are used. The actor is verified read-only before DDL and recorded in the manifest. Real non-success HTTP responses, rollback/no-partial-approval, durable discarded upload attempts, object absence, subsequent successful retry and unchanged expiry are asserted. Unproven fault or data cleanup prevents acceptance.

Cleanup covers owned checkout receipts/upload attempts/declined intents, private images, child bookings/rosters and fixture Auth users. Baseline organizations remain unchanged. Raw cookies, passwords, tokens and authentication state must not enter logs or artifacts. Preserve failed runs and distinguish harness faults from product failures; no automatic green retries.

Scenario mapping (all new cases initially **NOT RUN**):

| Approved coverage | Actual source coverage |
| --- | --- |
| REG-01/02/04 | Own profile/history and legacy null DOB; named/unnamed/profile validation; organizer-only/player counts; browser autofill and teammate isolation |
| REG-03 | Individual; group2/5 and invalid1/6; repeated positions; six-plus minimum-core composition and flat team totals; exact effective position totals |
| CHK-01 | Mixed three-game245000-cent quote, no pre-confirmation holds, UI edit/remove and exact per-game totals |
| CHK-02 | Actual concurrent final-slot contention; atomic decline/no child writes; durable declined-key replay after capacity recovery |
| CHK-03 | Shared original ten-minute expiry; same-key/mismatched-payload replay; expired upload denial/reallocation; My bookings continuation and matching versus unrelated unknown-intent recovery |
| CHK-04 | One checkout receipt auto-approves every child; concurrent duplicate upload; independent private bytes/ownership/public denial |
| CHK-05 | Actual scoped DB and Storage faults, rollback and safe retry; committed upload with dropped browser response and independent preserved receipt |
| CHK-06 | Compensating equal-total price changes and schedule-consent rejection; accepted price/quote preservation; seeded legacy age/status/amount/resume/private-image assertions |
| REG-UX | Desktop/mobile forms/review/recovery evidence; focus, countdown, required markers, stale quote response and native two-page bootstrap serialization held beyond20seconds |

Staff-allowed/Google UI remains **BLOCKED** pending a supported provider strategy; no provider identities are forged. Configured footer URLs and outbound email remain configuration dependencies. These tests do not accept M5 transfer/cancellation recovery or M9 real delivery. Literal simultaneous clock equality is not a browser timing guarantee: API tests force a deadline just into the past, while the separately retained PostgreSQL lock-wait expiry checks establish the database mechanism. Actual rendered UI/UX sign-off remains independent of Playwright success.


## Unified registration and owner-edit revision

Christian approved this revised local coverage on November4,2026. The original28 scenarios remain collected, with obsolete registration-option/count selectors replaced by actual Add another player controls and explicit `has_details` transport. This is source preparation, not acceptance execution.

Eight additional cases bring collection to36 in5files:

| Scenario | Observable assertions |
| --- | --- |
| UNI-01 | Actual7- and12-player holds each pay one effective team price; all roster entries persist and consume position capacity; exactly6 core players occupy the lineup team and extras remain unassigned; position-only data remains null; receipt approval retains all7 players. |
| UNI-02 | Capacity sufficient for the minimum core but insufficient for one additional Open rejects the entire multi-game checkout, with no partial holds. |
| EDIT-01 | Genuine authenticated owner supplies/clears one participant's details; other account and unrelated guest deny; stale versions and forbidden position/price/team changes deny; sibling rows, checkout/bookings/prices/receipt and legacy age-only data remain unchanged. |
| EDIT-02 | Genuine guest owner fills a position-only holding entry; actual server-time cutoff, cancelled game and expired hold deny later edits without changing that entry. |
| UNI-UX-01 | No registration-kind radio/count selector; add/remove count transitions1,2,5,6,7,12 and back update labels/pricing; minimum-core warnings block review without rewriting earlier positions; collapsed required fields open on native validation; optional details survive toggles while unchecked personal data is omitted from the real review request; desktop/mobile evidence. |
| EDIT-UX-01 | Guest My bookings edits/reloads personal details with position locked; successful refresh returns focus; a previously opened form cannot write after the actual server cutoff; refreshed controls display the lock; sibling booking facts and original expiry remain unchanged. |
| UNI-UX-02 | Organizer opt-out preserves six slots/positions/team price; opting back in restores the guest-entered profile; a named replacement is not overwritten, while the organizer uses a different empty slot; actual quote identity/count and no holds are checked. |
| EDIT-UX-02 | The real edit commits, then delivery is withheld beyond the actual20-second deadline. Unknown state disables Save and enables close/refresh; Escape triggers the real My bookings reload and recovers the committed row/version; siblings and booking/checkout history stay unchanged. |

The shared fixture now probes `roster_entries.has_details/version` before creating any organization. New participant payloads explicitly set `has_details`; null-name placeholders remain supported. Existing profile/history coverage additionally proves an authenticated position-only hold cannot overwrite the saved profile. Rate budgets are sized per case and still wait for the natural operational window; no row reset or guard bypass.

Cross-organization owner denial and exact pre-revision accepted-checkout fingerprint replay are covered by the separately reviewed fresh PostgreSQL proof and route/parser unit checks. They are not reported as HTTP/browser results. Recreating PostgreSQL's fingerprint in the test client or adding a production auth/test bypass is deliberately avoided. The HTTP deadline request arrives at or just after the cutoff; literal instantaneous equality is not a browser timing guarantee. Actual SQL comparison and source/edge-unit evidence establish the exact boundary mechanism.

Root must authorize the actual run only after final independent reviews, fresh database proof and the reviewed dedicated QA upgrade. Use the same safe runner with one worker and zero retries, fresh run/organization IDs, exact-owned cleanup and independently checked Auth/Storage/catalog baselines. Existing Google UI/staff-allowed checks remain BLOCKED; live email, remote services and publication remain outside this revision.

## Approved guided-navigation and Games revision

Christian approved this local coverage and confirmed guided steps in the existing dialog, full-screen on mobile, with one selected game at a time. The revised suite retains all36 previous cases and adds4 cases (expected40 total, subject to actual collection):

| Scenario | Observable assertions |
| --- | --- |
| UX-GAMES-01 | Default upcoming/ongoing excludes clock-ended and cancelled games. Independent history checkboxes expose the matching states. Full-position/full-game and lifecycle labels disable registration correctly, with no misleading remaining-slot copy after closure. |
| UX-GAMES-02 | An actual selected-ID GET is delayed then continued after dismissal; its late response cannot reopen checkout. Ordinary registration close causes no games/mine/workspace/selected collection refetch. |
| UX-GAMES-03 | Real game pages are bounded at12, include all19 same-date fixtures without duplicate/skip through timestamp ties, and preserve an off-page selection and its details. |
| UX-WIZ-01 | Mobile dialog occupies the viewport; Contact/one-game Players navigation preserves organizer and both games' player drafts. A collapsed incomplete detailed player opens and focuses the missing birthday before Next. The actual review payload contains retained details/counts and creates no holds. |

Retained M2 cases now use the optional single-date filter, venue dropdown and List/Table layouts. The old Calendar layout and week controls are intentionally absent. Existing checkout/browser cases navigate Contact first and explicitly activate each compact player editor; all real-service, ownership, price, expiry, receipt, optional-details, legacy and denial assertions remain. The old schedule API is still exercised explicitly as a compatibility boundary.

Source preparation is not acceptance. Root must release the dedicated rendered-review app/fixtures and authorize the frozen-candidate run. Keep one worker, zero retries, natural rate-window waits, actual report counts and owned cleanup. No successful service response substitution, live email, shared/remote writes or publication.


### Reviewed M2–M4 polish regression additions

Two additional approved cases bring the expected collection to42 (actual collection still required after source freeze):

| Scenario | Observable assertions |
| --- | --- |
| UX-WIZ-02 | Dirty pre-hold Close opens an accessible discard choice, Keep editing preserves current step and values, and Escape from that choice returns to the prior field. Explicit discard creates no holds and reopening starts a clean guest draft; untouched clean close remains immediate. |
| UX-WIZ-03 | Position-only, incomplete and complete summaries reflect actual details. Failed validation focuses Level and exposes a persistent associated error via aria-invalid/aria-describedby; correction clears the invalid state. With exactly one Open and Middle available, a temporary overallocated swap keeps Review disabled but remains correctable without changing reserved data or losing profile details. |

Intentional pre-hold discard in older browser cases now chooses Discard registration explicitly. Payment, committed/unknown-hold and owner-edit close/reconciliation tests retain their existing semantics. These source changes do not establish acceptance; wait for root's frozen-candidate run authorization.


### QA harness correction after run8f7d1478

The actual first attempt ended13passed/1failed/1interrupted/27not-run. The failure waited on an exact nested select label even though its dropdown was rendered. Games tests now locate the native Available position and Venue comboboxes by their label prefix; selected-value and behavior assertions remain unchanged. The explicit Choose player aria-label remains exact.

Playwright now uses `maxFailures: 1` (installed API documented in `node_modules/playwright/types/test.d.ts`) so the framework stops new cases and runs teardown after the first failure. This does not change one worker, zero retries, the42-case all-pass gate or evidence requirements. Interrupted-run cleanup and subsequent exact-owned recovery are recorded separately; they do not turn the failed run into a pass.
