# Registration notifications from Google Apps Script

The app uses Next.js Data Cache for Sheets reads. On Vercel this cache is shared
by function instances. A notification expires only the affected game's roster
and its weekly schedule; it does not read Sheets or create another registration.
Visible schedule pages and open player modals refresh quietly every 15 seconds.
Player details remain lazy: no roster request occurs until its modal is opened.
Hidden browser tabs stop polling and refresh when brought back into view.

## Configure Vercel

1. Generate a long random value, for example with `openssl rand -hex 32`.
2. Add it to the Vercel project's environment variables as
   `REGISTRATION_WEBHOOK_SECRET` for the production environment.
3. Deploy this app version. The endpoint is
   `POST https://YOUR-PRODUCTION-DOMAIN/api/registrations/updated`.
4. Keep the secret out of `NEXT_PUBLIC_*` variables and browser code.

The existing `CACHE_CLEAR_SECRET` and manual cache-clear endpoint still work
and now expire the shared cache. They do not need to use the webhook secret.

## Configure Apps Script

The updated complete script is in `scripts/google-apps-script/registration.gs`.
It retains your original spreadsheet, form options, team expansion, and invite
helpers. The submit handler writes team rows, flushes pending writes, notifies
the app, and then sends the calendar invite. Notification and invite failures
are handled separately. Transient notification failures are retried up to three
times; no secret or response body is logged.

1. Replace the existing Apps Script code with the updated file.
2. Open **Project Settings → Script Properties** and add:

   | Property | Value |
   | --- | --- |
   | `DVC_APP_URL` | Your public production URL, such as `https://your-app.vercel.app` |
   | `DVC_WEBHOOK_SECRET` | The same value as Vercel's `REGISTRATION_WEBHOOK_SECRET` |

3. Run `testDvcWebhook` from the editor and approve URL Fetch authorization.
   This test invalidates a game cache without adding players or sending invites.
   The execution log should say `DVC webhook connection succeeded.`
4. Keep the existing spreadsheet form-submit trigger. If it is missing, run
   `installTrigger` once. Do not create a second trigger for notifications.

Use a stable HTTPS production domain. Apps Script runs on Google's servers and
cannot call `127.0.0.1:3101` on your computer. If Vercel deployment protection
requires authentication, the script also needs an authorized way through that
protection; an HTTP redirect is not treated as a successful webhook.

## Verify the complete flow

1. Open the app and the target game's **View Registered Players** modal.
2. Submit an individual registration using the actual Google Form.
3. Confirm the sheet has the new registration, the webhook execution succeeds,
   and the visible schedule and modal update on the next refresh, normally
   within 15 seconds after the notification is accepted.
4. Submit a team registration and confirm all six position entries are present
   before checking the app's totals.
5. Close the modal and confirm roster polling stops. Bring a hidden tab back
   into view and confirm it refreshes.

The notification runs after Apps Script's pending writes are flushed; formula
recalculation and network latency can add delay. This is polling, not instant
browser push. If the notification fails or someone edits Sheets manually, the
existing 60-second roster and 120-second schedule revalidation windows remain
as a fallback. Time-based revalidation may serve the previous result once while
refreshing it in the background.

## Request contract

Send JSON containing only the spreadsheet and game identity:

```json
{
  "spreadsheetId": "YOUR_SPREADSHEET_ID",
  "scheduleOption": "10-13-26 - San Carlos Seminary (Tue, 6:30PM-9:30PM)"
}
```

Authenticate with the `x-registration-key` header. A successful request returns
`{"revalidated":true}`. Repeating a request only expires the same cache tags.
Player names, emails, payment details, and calendar events are not sent to this
endpoint.

References: [Next.js Data Cache](https://nextjs.org/docs/app/api-reference/functions/unstable_cache),
[webhook tag expiration](https://nextjs.org/docs/app/api-reference/functions/revalidateTag),
[Apps Script form-submit triggers](https://developers.google.com/apps-script/guides/triggers/installable),
[SpreadsheetApp.flush](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app#flush()),
and [UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app).
