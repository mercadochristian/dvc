# DVC Fun Games — Schedule Dashboard Design

**Date:** 2026-04-06  
**Status:** Approved

## Overview

A standalone, read-only Next.js web app that shows players the available positions for upcoming DVC Fun Games volleyball sessions each week. Data is sourced entirely from Google Sheets (private). No player login required — the dashboard is fully public and read-only.

Deployed to Vercel. Designed mobile-first with a dark theme, matching the mockup shared during brainstorming.

---

## Tech Stack

- **Framework:** Next.js 15 (App Router) + TypeScript
- **Styling:** Tailwind CSS v4
- **Google APIs:** `googleapis` npm package (Sheets API v4 + Drive API v3)
- **Auth:** Google Service Account (2 env vars — no OAuth flow)
- **Deployment:** Vercel

---

## Repository

A new standalone GitHub repository separate from the main DVC app. Suggested name: `dvc-schedule`.

---

## Data Sources

### Game Schedule Sheet Tab

Every weekly spreadsheet contains a tab named **`Game Schedule`** (exact name). It has these columns:

| Column | Description |
|--------|-------------|
| Date | e.g. `April 14, 2026` |
| Location | e.g. `San Carlos Seminary` |
| Time | e.g. `6:30PM-9:30PM` |
| Teams | Integer — used to derive position counts |
| City | e.g. `Makati` |
| Status | Optional. If value is `Cancelled`, game is marked as cancelled. |

The `Status` column does not need to exist on every row — absence means active.

### Registration Response Tabs

Each game has its own tab named in this format:
```
MM-DD-YY - Location Name (Day, HH:MMPM-HH:MMPM)
```
Example: `04-14-26 - San Carlos Seminary (Tue, 6:30PM-9:30PM)`

Each row is a registered player. The relevant column is:

| Column | Values |
|--------|--------|
| Position | `Open Spiker`, `Opposite Spiker`, `Middle Blocker`, `Setter` |

**Filled count** = number of rows where `Position` equals the target value.

### Weekly Spreadsheet Discovery (Drive API)

The app uses the Drive API to search for spreadsheets matching the pattern:
```
"Week X 2026 - DVC Fun Games Registration (Responses)"
```

All matching files are returned and sorted by week number (parsed from the name). The app displays the sheet whose date range includes today by default. The week navigator allows browsing all found weeks.

---

## Position Formula

Derived from the `Teams` column in the Game Schedule tab. No explicit position columns needed.

| Position | Formula |
|----------|---------|
| Open Spiker | Teams × 2 |
| Opposite Spiker | Teams × 1 |
| Middle Blocker | Teams × 2 |
| Setter | Teams × 1 |

**Available = Needed − Filled**

---

## API Route

### `GET /api/weeks`

Searches Google Drive for all spreadsheets matching the name pattern. Returns week metadata parsed from sheet names only — does **not** read any sheet content (fast, no quota cost per sheet).

**Response shape:**
```ts
{
  weeks: {
    id: string          // Spreadsheet ID (Google Drive file ID)
    weekNumber: number  // Parsed from sheet name, e.g. 16
    name: string        // Full sheet name
  }[]
  // Sorted ascending by weekNumber
  // Client defaults to the highest weekNumber as "current"
}
```

### `GET /api/schedule?week=<spreadsheetId>`

Server-side only. Uses service account credentials from env vars. Reads the Game Schedule tab and all matching registration tabs from the given spreadsheet. Never exposes credentials to the browser.

**Query param:** `week` — the Google Spreadsheet ID. Client gets this from `/api/weeks`.

**Response shape:**
```ts
{
  weekNumber: number
  dateRange: string   // e.g. "Apr 14 – Apr 19, 2026" — derived from min/max dates in Game Schedule tab
  days: {
    date: string      // e.g. "TUESDAY, APR 14"
    games: {
      id: string        // derived from tab name
      location: string
      city: string
      time: string
      cancelled: boolean
      status: "open" | "almost_full" | "full" | "cancelled"
      positions: {
        name: "Open Spiker" | "Opposite Spiker" | "Middle Blocker" | "Setter"
        needed: number
        filled: number   // 0 if no registration tab exists yet for this game
        available: number
      }[]
    }[]
  }[]
}
```

**Missing registration tab handling:** If no tab matching a game is found, `filled` defaults to 0 for all positions (all slots shown as available).

---

## Status Badge Logic

Computed server-side and included in the API response as `status`:

| Condition | Status |
|-----------|--------|
| `cancelled: true` | `cancelled` |
| All positions `available === 0` | `full` |
| Any position `available <= 2` | `almost_full` |
| Otherwise | `open` |

---

## Position Slot Color Logic

Computed client-side per position cell:

| Condition | Display |
|-----------|---------|
| `available === 0` | Red text "Full", red border highlight |
| `available <= 2` | Orange number |
| `available > 2` | Green number |

---

## UI Components

### `page.tsx` (Client Component)
- Fetches `/api/weeks` on mount to get all week options and current week ID
- Fetches `/api/schedule?week=<id>` when week changes
- Polls `/api/schedule` every 5 minutes via `setInterval`
- Shows "Last updated: HH:MM · refreshes every 5 min" footer
- Passes data down to `WeekNavigator` and `DayGroup` components

### `WeekNavigator`
- Prev/next arrow buttons
- Displays "Week X" label and date range
- Disables prev/next when at the first/last available week

### `DayGroup`
- Renders a date header (e.g. "TUESDAY, APR 14")
- Lists `GameCard` components for that day

### `GameCard`
- Shows location name, time, city
- Shows `StatusBadge`
- Renders 2×2 grid of `PositionSlot` components
- Shows per-game inquiry row: Messenger and Instagram icon buttons (hidden when `cancelled: true`)
- When `cancelled: true`: applies strikethrough to location name, dims entire card, hides inquiry buttons

### `ContactBar`
- Persistent header or footer bar visible on all screens
- Two icon buttons: Messenger, Instagram
- Links to configured contact URLs from env vars

### `PositionSlot`
- Shows position label and available count (or "Full")
- Color is determined by available count (green / orange / red)

### `StatusBadge`
- Pill badge with label and color matching status

---

## Cancellation Workflow

1. Admin opens the weekly Google Sheet
2. Navigates to the `Game Schedule` tab
3. Adds a `Status` column (if not present) and sets the cell to `Cancelled`
4. Within 5 minutes (next poll cycle), the dashboard reflects the cancellation

No admin UI is needed in the app itself.

---

## Environment Variables

Two variables required in Vercel:

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

CONTACT_MESSENGER_URL=https://m.me/<page-username>
CONTACT_INSTAGRAM_URL=https://instagram.com/<username>
```

All weekly spreadsheets must be shared with the service account email (as Viewer).

---

## Tab Name Matching

To map a Game Schedule row to its registration tab, the app constructs the expected tab name from the row's Date, Location, and Time fields and searches the spreadsheet's sheet list for a match. Matching is done by normalizing whitespace and casing to be resilient to minor formatting differences.

---

## Vercel Deployment

- No build-time data fetching — all data is fetched at request time via API routes
- `GOOGLE_PRIVATE_KEY` newlines must be escaped as `\n` in Vercel's env var UI
- No database, no auth middleware, no session management

---

## Registration Workflow

The dashboard is read-only. Registration happens outside the app:

1. Player checks available slots on the dashboard
2. Player contacts the admin via Messenger, Telegram, or Instagram to inquire
3. Admin sends the Google Form link to the player
4. Player fills out the Google Form to register

The app supports this workflow by providing contact links at two levels:

### Global Contact Button (Header/Footer)
A persistent contact bar visible on all screens. Shows three icon buttons:
- **Messenger** — links to admin's Messenger page
- **Instagram** — links to admin's Instagram profile

### Per-Game Inquiry Button
Each game card has an inquiry icon row. Tapping Messenger pre-fills context where supported (e.g., `m.me/<page>?ref=<game-id>`). Instagram links to the profile directly.

### Configuration
Contact links are set via Vercel environment variables — no code change needed to update them:

```
CONTACT_MESSENGER_URL=https://m.me/<page-username>
CONTACT_INSTAGRAM_URL=https://instagram.com/<username>
```

---

## Out of Scope

- Player registration form within the app (handled via Google Forms sent by admin)
- Admin UI for managing schedules or cancellations
- Authentication/login for players
- Push notifications or email alerts
- Historical statistics
