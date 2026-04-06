# DVC Fun Games Schedule Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone read-only Next.js 15 dashboard that reads volleyball game position availability from private Google Sheets and displays it with a mobile-first dark UI, deployed to Vercel.

**Architecture:** Two server-side API routes (`/api/weeks` — Drive search, `/api/schedule` — Sheets data) are consumed by a single client-side page that polls every 5 minutes and supports week navigation. All Google API calls happen server-side using a service account.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS v4, `googleapis` npm package, Vitest for testing.

> **Note:** All tasks run inside the new `dvc-schedule/` directory, not the existing DVC repo. Create this directory wherever you keep projects (e.g. `~/code/dvc-schedule`).

---

## File Map

```
dvc-schedule/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout — dark mode class, metadata, no 'use client'
│   │   ├── page.tsx                # Dashboard page — 'use client', week state, auto-refresh
│   │   ├── globals.css             # Tailwind v4 import + CSS custom properties
│   │   └── api/
│   │       ├── weeks/route.ts      # GET /api/weeks — Drive search, returns WeekInfo[]
│   │       └── schedule/route.ts   # GET /api/schedule?week=<id> — full WeekSchedule
│   ├── components/
│   │   ├── contact-bar.tsx         # Messenger + Instagram icon buttons (header)
│   │   ├── week-navigator.tsx      # Prev/next arrows + week label + date range
│   │   ├── day-group.tsx           # Date header + list of GameCards
│   │   ├── game-card.tsx           # Location, status, position grid, inquiry row
│   │   ├── position-slot.tsx       # Single position cell (green/orange/red/"Full")
│   │   └── status-badge.tsx        # Pill badge (open/almost_full/full/cancelled)
│   └── lib/
│       ├── types.ts                # All shared TypeScript types (no logic)
│       ├── parse.ts                # Pure parsing/computation functions (testable)
│       └── sheets.ts               # Google API client + buildWeekSchedule orchestration
├── src/__tests__/
│   └── parse.test.ts               # Unit tests for pure functions in parse.ts
├── .env.local                      # Local secrets — gitignored
├── .env.example                    # Template for required env vars
├── vitest.config.ts                # Vitest config
├── next.config.ts
├── package.json
└── tsconfig.json
```

---

### Task 1: Scaffold the project

**Files:**
- Create: `dvc-schedule/` (new directory)
- Modify: `src/app/globals.css`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create Next.js app**

```bash
npx create-next-app@latest dvc-schedule \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --no-eslint \
  --import-alias "@/*"
cd dvc-schedule
```

- [ ] **Step 2: Install googleapis and vitest**

```bash
npm install googleapis
npm install -D vitest @vitest/coverage-v8
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 4: Add test script to package.json**

Open `package.json` and add to the `"scripts"` block:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Replace globals.css with dark theme tokens**

```css
/* src/app/globals.css */
@import "tailwindcss";

:root {
  --bg-body: #0f1117;
  --bg-surface: #13151f;
  --bg-card: #1a1d2e;
  --border-base: #1e2535;
  --border-card: #252840;
  --text-primary: #f1f5f9;
  --text-secondary: #64748b;
  --text-muted: #334155;
  --accent: #6366f1;
  --green: #4ade80;
  --orange: #fb923c;
  --red: #f87171;
  --bg-green-dim: #14532d;
  --bg-orange-dim: #451a03;
  --bg-red-dim: #450a0a;
  --bg-full-slot: #1c0a0a;
  --border-full: #7f1d1d;
  --slate-400: #94a3b8;
}
```

- [ ] **Step 6: Create .env.example**

```bash
# .env.example
# Google Service Account credentials
# Create at console.cloud.google.com > IAM > Service Accounts
# Share all weekly sheets with the client_email as Viewer
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nABC123...\n-----END PRIVATE KEY-----\n"

# Public contact links (visible to players)
# These use NEXT_PUBLIC_ prefix so they are accessible in client components
NEXT_PUBLIC_CONTACT_MESSENGER_URL=https://m.me/your-page-username
NEXT_PUBLIC_CONTACT_INSTAGRAM_URL=https://instagram.com/your-username
```

- [ ] **Step 7: Create .env.local with your actual values**

```bash
cp .env.example .env.local
# Edit .env.local and fill in real values — this file is gitignored
```

- [ ] **Step 8: Verify .gitignore contains .env.local**

Open `.gitignore` and confirm it has:
```
.env.local
.env*.local
```

- [ ] **Step 9: Initial commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js 15 project with Tailwind v4 and Vitest"
```

---

### Task 2: TypeScript types

**Files:**
- Create: `src/lib/types.ts`

- [ ] **Step 1: Create types.ts**

```ts
// src/lib/types.ts

export type PositionName =
  | 'Open Spiker'
  | 'Opposite Spiker'
  | 'Middle Blocker'
  | 'Setter'

export const POSITION_NAMES: PositionName[] = [
  'Open Spiker',
  'Opposite Spiker',
  'Middle Blocker',
  'Setter',
]

export type GameStatus = 'open' | 'almost_full' | 'full' | 'cancelled'

export interface Position {
  name: PositionName
  needed: number
  filled: number
  available: number
}

export interface Game {
  id: string
  location: string
  city: string
  time: string
  cancelled: boolean
  status: GameStatus
  positions: Position[]
}

export interface DaySchedule {
  date: string  // e.g. "TUESDAY, APR 14"
  games: Game[]
}

export interface WeekSchedule {
  weekNumber: number
  dateRange: string  // e.g. "Apr 14 – Apr 19, 2026"
  days: DaySchedule[]
}

export interface WeekInfo {
  id: string          // Google Spreadsheet ID
  weekNumber: number  // Parsed from sheet name, e.g. 16
  name: string        // Full sheet name
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add shared TypeScript types"
```

---

### Task 3: Parsing utilities + tests

**Files:**
- Create: `src/lib/parse.ts`
- Create: `src/__tests__/parse.test.ts`

- [ ] **Step 1: Write the failing tests first**

```ts
// src/__tests__/parse.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseWeekNumber,
  computeNeeded,
  computeGameStatus,
  buildDateRange,
  makeGameKey,
  parseRegistrationTabName,
  formatDayLabel,
} from '@/lib/parse'

describe('parseWeekNumber', () => {
  it('extracts week number from full sheet name', () => {
    expect(
      parseWeekNumber('Week 16 2026 - DVC Fun Games Registration (Responses)')
    ).toBe(16)
  })
  it('handles single-digit week', () => {
    expect(parseWeekNumber('Week 4 2026 - DVC Fun Games Registration')).toBe(4)
  })
  it('returns 0 when no match found', () => {
    expect(parseWeekNumber('Game Schedule')).toBe(0)
  })
})

describe('computeNeeded', () => {
  it('computes correct positions for 4 teams', () => {
    const result = computeNeeded(4)
    expect(result['Open Spiker']).toBe(8)
    expect(result['Opposite Spiker']).toBe(4)
    expect(result['Middle Blocker']).toBe(8)
    expect(result['Setter']).toBe(4)
  })
  it('computes correct positions for 3 teams', () => {
    const result = computeNeeded(3)
    expect(result['Open Spiker']).toBe(6)
    expect(result['Opposite Spiker']).toBe(3)
    expect(result['Middle Blocker']).toBe(6)
    expect(result['Setter']).toBe(3)
  })
  it('returns all zeros for 0 teams', () => {
    const result = computeNeeded(0)
    expect(result['Open Spiker']).toBe(0)
    expect(result['Setter']).toBe(0)
  })
})

describe('computeGameStatus', () => {
  it('returns cancelled when cancelled is true regardless of availability', () => {
    expect(computeGameStatus([{ available: 5 }], true)).toBe('cancelled')
  })
  it('returns full when all positions have 0 available', () => {
    expect(
      computeGameStatus([{ available: 0 }, { available: 0 }, { available: 0 }, { available: 0 }], false)
    ).toBe('full')
  })
  it('returns almost_full when any position has exactly 2 available', () => {
    expect(
      computeGameStatus([{ available: 8 }, { available: 2 }, { available: 8 }, { available: 4 }], false)
    ).toBe('almost_full')
  })
  it('returns almost_full when any position has 1 available', () => {
    expect(
      computeGameStatus([{ available: 5 }, { available: 1 }], false)
    ).toBe('almost_full')
  })
  it('returns open when all positions have more than 2 available', () => {
    expect(
      computeGameStatus([{ available: 8 }, { available: 4 }, { available: 8 }, { available: 4 }], false)
    ).toBe('open')
  })
})

describe('buildDateRange', () => {
  it('formats range within same month', () => {
    expect(
      buildDateRange(['April 14, 2026', 'April 15, 2026', 'April 19, 2026'])
    ).toBe('Apr 14 – Apr 19, 2026')
  })
  it('handles single date', () => {
    expect(buildDateRange(['April 14, 2026'])).toBe('Apr 14 – Apr 14, 2026')
  })
  it('returns empty string for empty array', () => {
    expect(buildDateRange([])).toBe('')
  })
  it('sorts dates before computing range', () => {
    expect(
      buildDateRange(['April 19, 2026', 'April 14, 2026'])
    ).toBe('Apr 14 – Apr 19, 2026')
  })
})

describe('parseRegistrationTabName', () => {
  it('parses a valid registration tab name', () => {
    const result = parseRegistrationTabName(
      '04-14-26 - San Carlos Seminary (Tue, 6:30PM-9:30PM)'
    )
    expect(result).not.toBeNull()
    expect(result?.location).toBe('San Carlos Seminary')
    expect(result?.time).toBe('6:30PM-9:30PM')
  })
  it('parses tab with different location', () => {
    const result = parseRegistrationTabName(
      '04-15-26 - CV Quad Court (Wed, 7PM-10PM)'
    )
    expect(result).not.toBeNull()
    expect(result?.location).toBe('CV Quad Court')
    expect(result?.time).toBe('7PM-10PM')
  })
  it('returns null for Game Schedule tab', () => {
    expect(parseRegistrationTabName('Game Schedule')).toBeNull()
  })
  it('returns null for plain text', () => {
    expect(parseRegistrationTabName('Sheet1')).toBeNull()
  })
})

describe('makeGameKey', () => {
  it('normalizes to lowercase and trims', () => {
    const key = makeGameKey('April 14, 2026', '  San Carlos Seminary  ', ' 6:30PM-9:30PM ')
    expect(key).toBe('april 14, 2026|san carlos seminary|6:30pm-9:30pm')
  })
  it('produces matching keys for same game from different sources', () => {
    const scheduleKey = makeGameKey('April 14, 2026', 'San Carlos Seminary', '6:30PM-9:30PM')
    const tabParsed = parseRegistrationTabName('04-14-26 - San Carlos Seminary (Tue, 6:30PM-9:30PM)')
    const tabKey = makeGameKey(tabParsed!.date, tabParsed!.location, tabParsed!.time)
    expect(scheduleKey).toBe(tabKey)
  })
})

describe('formatDayLabel', () => {
  it('formats a date string to day label', () => {
    expect(formatDayLabel('April 14, 2026')).toBe('TUESDAY, APR 14')
  })
  it('returns uppercase original string if date cannot be parsed', () => {
    expect(formatDayLabel('not-a-date')).toBe('NOT-A-DATE')
  })
})
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
npm test
```

Expected: All tests FAIL with "Cannot find module '@/lib/parse'"

- [ ] **Step 3: Create parse.ts**

```ts
// src/lib/parse.ts
import { GameStatus, PositionName, POSITION_NAMES } from './types'

/**
 * Parse week number from sheet name.
 * "Week 16 2026 - DVC Fun Games Registration (Responses)" → 16
 */
export function parseWeekNumber(name: string): number {
  const match = name.match(/Week\s+(\d+)/i)
  if (!match) return 0
  return parseInt(match[1], 10)
}

/**
 * Compute position needed counts from team count.
 * Open Spiker = teams × 2, Opposite = teams × 1, Mid Blocker = teams × 2, Setter = teams × 1
 */
export function computeNeeded(teams: number): Record<PositionName, number> {
  return {
    'Open Spiker': teams * 2,
    'Opposite Spiker': teams * 1,
    'Middle Blocker': teams * 2,
    'Setter': teams * 1,
  }
}

/**
 * Compute game status from positions and cancelled flag.
 */
export function computeGameStatus(
  positions: { available: number }[],
  cancelled: boolean
): GameStatus {
  if (cancelled) return 'cancelled'
  if (positions.every(p => p.available === 0)) return 'full'
  if (positions.some(p => p.available <= 2)) return 'almost_full'
  return 'open'
}

/**
 * Build date range string from an array of date strings.
 * ["April 14, 2026", ..., "April 19, 2026"] → "Apr 14 – Apr 19, 2026"
 */
export function buildDateRange(dates: string[]): string {
  if (dates.length === 0) return ''
  const parsed = dates
    .map(d => new Date(d))
    .filter(d => !isNaN(d.getTime()))
  if (parsed.length === 0) return ''
  parsed.sort((a, b) => a.getTime() - b.getTime())
  const first = parsed[0]
  const last = parsed[parsed.length - 1]
  const fmtShort = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const year = last.getFullYear()
  return `${fmtShort(first)} – ${fmtShort(last)}, ${year}`
}

/**
 * Build a normalized key for matching Game Schedule rows to registration tabs.
 * Both sides use this function so the comparison is always consistent.
 */
export function makeGameKey(date: string, location: string, time: string): string {
  return `${date.toLowerCase().trim()}|${location.toLowerCase().trim()}|${time.toLowerCase().trim()}`
}

/**
 * Parse a registration tab name into structured fields.
 * "04-14-26 - San Carlos Seminary (Tue, 6:30PM-9:30PM)"
 * → { date: "April 14, 2026", location: "San Carlos Seminary", time: "6:30PM-9:30PM" }
 * Returns null if the tab name does not match the expected pattern.
 */
export function parseRegistrationTabName(tabName: string): {
  date: string
  location: string
  time: string
} | null {
  const match = tabName.match(/^(\d{2})-(\d{2})-(\d{2})\s*-\s*(.+?)\s*\([\w]+,\s*(.+?)\)$/)
  if (!match) return null
  const [, mm, dd, yy, location, time] = match
  const year = 2000 + parseInt(yy, 10)
  const date = new Date(`${year}-${mm}-${dd}`)
  if (isNaN(date.getTime())) return null
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  return { date: dateStr, location: location.trim(), time: time.trim() }
}

/**
 * Format a date string like "April 14, 2026" to "TUESDAY, APR 14".
 * Falls back to uppercased original if parsing fails.
 */
export function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr.toUpperCase()
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
  const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
  const day = date.getDate()
  return `${weekday}, ${month} ${day}`
}

/**
 * Re-export POSITION_NAMES for use in sheets.ts without importing types directly.
 */
export { POSITION_NAMES }
```

- [ ] **Step 4: Run tests — verify they all pass**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/parse.ts src/__tests__/parse.test.ts
git commit -m "feat: add parsing utilities with full test coverage"
```

---

### Task 4: Google Sheets/Drive client

**Files:**
- Create: `src/lib/sheets.ts`

- [ ] **Step 1: Create sheets.ts**

```ts
// src/lib/sheets.ts
import { google } from 'googleapis'
import {
  WeekInfo,
  WeekSchedule,
  DaySchedule,
  Game,
  Position,
  POSITION_NAMES,
  PositionName,
} from './types'
import {
  parseWeekNumber,
  computeNeeded,
  computeGameStatus,
  buildDateRange,
  makeGameKey,
  parseRegistrationTabName,
  formatDayLabel,
} from './parse'

function getAuthClient() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  })
}

/**
 * Search Google Drive for all weekly registration spreadsheets.
 * Returns sorted ascending by week number.
 */
export async function searchWeeklySheets(): Promise<WeekInfo[]> {
  const auth = getAuthClient()
  const drive = google.drive({ version: 'v3', auth })
  const res = await drive.files.list({
    q: `name contains 'DVC Fun Games Registration' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 100,
  })
  const files = res.data.files ?? []
  return files
    .filter(f => f.id && f.name && parseWeekNumber(f.name) > 0)
    .map(f => ({
      id: f.id!,
      name: f.name!,
      weekNumber: parseWeekNumber(f.name!),
    }))
    .sort((a, b) => a.weekNumber - b.weekNumber)
}

/**
 * Read values from a specific sheet range.
 * Returns a 2D array of strings (empty cells → empty string).
 */
async function getSheetValues(
  spreadsheetId: string,
  range: string
): Promise<string[][]> {
  const auth = getAuthClient()
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range })
  return (res.data.values ?? []) as string[][]
}

/**
 * Get all tab names in a spreadsheet.
 */
async function getSheetTabNames(spreadsheetId: string): Promise<string[]> {
  const auth = getAuthClient()
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  })
  return (res.data.sheets ?? []).map(s => s.properties?.title ?? '').filter(Boolean)
}

/**
 * Build the full WeekSchedule for a given spreadsheet ID.
 * Reads the Game Schedule tab and all matching registration tabs.
 */
export async function buildWeekSchedule(
  spreadsheetId: string,
  weekNumber: number
): Promise<WeekSchedule> {
  // 1. Get all tab names for matching later
  const tabNames = await getSheetTabNames(spreadsheetId)

  // 2. Read Game Schedule tab (first row = headers)
  const scheduleValues = await getSheetValues(spreadsheetId, 'Game Schedule')
  if (scheduleValues.length < 2) {
    return { weekNumber, dateRange: '', days: [] }
  }

  const headers = scheduleValues[0].map(h => h.toLowerCase().trim())
  const rows = scheduleValues.slice(1)

  const col = (name: string) => headers.indexOf(name)
  const dateCol = col('date')
  const locationCol = col('location')
  const timeCol = col('time')
  const teamsCol = col('teams')
  const cityCol = col('city')
  const statusCol = col('status')

  // 3. Build a map from normalized game key → registration tab name
  const tabKeyMap = new Map<string, string>()
  for (const tabName of tabNames) {
    const parsed = parseRegistrationTabName(tabName)
    if (parsed) {
      tabKeyMap.set(makeGameKey(parsed.date, parsed.location, parsed.time), tabName)
    }
  }

  // 4. Process each row in Game Schedule
  const allDates: string[] = []
  // Use a Map to preserve insertion order (dates appear in sheet order)
  const dayMap = new Map<string, Game[]>()

  for (const row of rows) {
    const date = row[dateCol]?.trim() ?? ''
    const location = row[locationCol]?.trim() ?? ''
    const time = row[timeCol]?.trim() ?? ''
    const teams = parseInt(row[teamsCol] ?? '0', 10) || 0
    const city = row[cityCol]?.trim() ?? ''
    const statusVal = row[statusCol]?.trim() ?? ''

    if (!date || !location) continue
    allDates.push(date)

    const cancelled = statusVal.toLowerCase() === 'cancelled'
    const needed = computeNeeded(teams)

    // Find the matching registration tab
    const gameKey = makeGameKey(date, location, time)
    const matchingTab = tabKeyMap.get(gameKey)

    // Count filled positions from the registration tab
    const filled: Record<PositionName, number> = {
      'Open Spiker': 0,
      'Opposite Spiker': 0,
      'Middle Blocker': 0,
      'Setter': 0,
    }

    if (matchingTab) {
      const regValues = await getSheetValues(spreadsheetId, `'${matchingTab}'`)
      if (regValues.length >= 2) {
        const regHeaders = regValues[0].map(h => h.toLowerCase().trim())
        const posCol = regHeaders.indexOf('position')
        if (posCol >= 0) {
          for (const regRow of regValues.slice(1)) {
            const pos = regRow[posCol]?.trim() as PositionName
            if (POSITION_NAMES.includes(pos)) {
              filled[pos]++
            }
          }
        }
      }
    }

    // Build positions array
    const positions: Position[] = POSITION_NAMES.map(name => ({
      name,
      needed: needed[name],
      filled: filled[name],
      available: Math.max(0, needed[name] - filled[name]),
    }))

    const status = computeGameStatus(positions, cancelled)
    const gameId = `${date}-${location}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

    const game: Game = { id: gameId, location, city, time, cancelled, status, positions }

    // Group by date (using date string as key to preserve order)
    if (!dayMap.has(date)) dayMap.set(date, [])
    dayMap.get(date)!.push(game)
  }

  // 5. Assemble days array
  const days: DaySchedule[] = Array.from(dayMap.entries()).map(([date, games]) => ({
    date: formatDayLabel(date),
    games,
  }))

  return {
    weekNumber,
    dateRange: buildDateRange(allDates),
    days,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/sheets.ts
git commit -m "feat: add Google Sheets/Drive client and buildWeekSchedule"
```

---

### Task 5: /api/weeks route

**Files:**
- Create: `src/app/api/weeks/route.ts`

- [ ] **Step 1: Create the route**

```ts
// src/app/api/weeks/route.ts
import { NextResponse } from 'next/server'
import { searchWeeklySheets } from '@/lib/sheets'

export async function GET() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Google credentials not configured' },
      { status: 500 }
    )
  }

  try {
    const weeks = await searchWeeklySheets()
    return NextResponse.json({ weeks })
  } catch (err) {
    console.error('[/api/weeks] error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch weekly sheets' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Smoke-test the route manually**

```bash
npm run dev
```

Open: `http://localhost:3000/api/weeks`

Expected: JSON with a `weeks` array. If credentials are not yet set up, you'll see `{ "error": "Google credentials not configured" }` — that's fine for now.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/weeks/route.ts
git commit -m "feat: add /api/weeks route for Drive sheet discovery"
```

---

### Task 6: /api/schedule route

**Files:**
- Create: `src/app/api/schedule/route.ts`

- [ ] **Step 1: Create the route**

```ts
// src/app/api/schedule/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { buildWeekSchedule } from '@/lib/sheets'
import { parseWeekNumber } from '@/lib/parse'
import { searchWeeklySheets } from '@/lib/sheets'

export async function GET(request: NextRequest) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Google credentials not configured' },
      { status: 500 }
    )
  }

  const { searchParams } = request.nextUrl
  const weekId = searchParams.get('week')

  if (!weekId) {
    return NextResponse.json(
      { error: 'Missing required query param: week' },
      { status: 400 }
    )
  }

  try {
    // Look up weekNumber for the given spreadsheet ID
    const weeks = await searchWeeklySheets()
    const weekInfo = weeks.find(w => w.id === weekId)
    const weekNumber = weekInfo?.weekNumber ?? 0

    const schedule = await buildWeekSchedule(weekId, weekNumber)
    return NextResponse.json(schedule)
  } catch (err) {
    console.error('[/api/schedule] error:', err)
    return NextResponse.json(
      { error: 'Failed to load schedule' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Smoke-test the route manually**

With `npm run dev` running, open:
`http://localhost:3000/api/schedule?week=<a-real-spreadsheet-id>`

Expected: Full JSON schedule with `weekNumber`, `dateRange`, and `days`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/schedule/route.ts
git commit -m "feat: add /api/schedule route for full week data"
```

---

### Task 7: StatusBadge component

**Files:**
- Create: `src/components/status-badge.tsx`

- [ ] **Step 1: Create StatusBadge**

```tsx
// src/components/status-badge.tsx
import { GameStatus } from '@/lib/types'

const CONFIG: Record<GameStatus, { label: string; className: string }> = {
  open:        { label: 'Slots open',  className: 'bg-[#14532d] text-[#4ade80]' },
  almost_full: { label: 'Almost full', className: 'bg-[#451a03] text-[#fb923c]' },
  full:        { label: 'Full',        className: 'bg-[#450a0a] text-[#f87171]' },
  cancelled:   { label: 'Cancelled',   className: 'bg-[#1e2535] text-[#94a3b8]' },
}

export function StatusBadge({ status }: { status: GameStatus }) {
  const { label, className } = CONFIG[status]
  return (
    <span
      className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ml-2 mt-0.5 ${className}`}
    >
      {label}
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/status-badge.tsx
git commit -m "feat: add StatusBadge component"
```

---

### Task 8: PositionSlot component

**Files:**
- Create: `src/components/position-slot.tsx`

- [ ] **Step 1: Create PositionSlot**

```tsx
// src/components/position-slot.tsx
import { Position } from '@/lib/types'

export function PositionSlot({ position }: { position: Position }) {
  const { name, available } = position
  const isFull = available === 0
  const isLow = available > 0 && available <= 2

  // Shorten "Opposite Spiker" to "Opposite" and "Middle Blocker" to "Mid Blocker" for display
  const displayName = name === 'Opposite Spiker' ? 'Opposite' : name

  return (
    <div
      className={`rounded-[10px] p-2.5 text-center border ${
        isFull
          ? 'bg-[#1c0a0a] border-[#7f1d1d]'
          : 'bg-[#0f1117] border-[#252840]'
      }`}
    >
      <div className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1">
        {displayName}
      </div>
      {isFull ? (
        <div className="text-sm font-bold text-[#f87171]">Full</div>
      ) : (
        <div
          className={`text-[22px] font-extrabold leading-none ${
            isLow ? 'text-[#fb923c]' : 'text-[#4ade80]'
          }`}
        >
          {available}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/position-slot.tsx
git commit -m "feat: add PositionSlot component with green/orange/red color logic"
```

---

### Task 9: GameCard component

**Files:**
- Create: `src/components/game-card.tsx`

- [ ] **Step 1: Create GameCard**

```tsx
// src/components/game-card.tsx
import { Game } from '@/lib/types'
import { StatusBadge } from './status-badge'
import { PositionSlot } from './position-slot'

const MessengerIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white flex-shrink-0">
    <path d="M12 2C6.477 2 2 6.145 2 11.259c0 2.84 1.275 5.381 3.306 7.165v3.576l3.285-1.8c.877.24 1.808.37 2.768.37 5.523 0 10-4.144 10-9.259C22 6.146 17.523 2 12 2zm1.07 12.483-2.549-2.67-4.976 2.67 5.474-5.804 2.612 2.67 4.913-2.67-5.474 5.804z" />
  </svg>
)

const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white flex-shrink-0">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
  </svg>
)

interface GameCardProps {
  game: Game
  messengerUrl: string
  instagramUrl: string
}

export function GameCard({ game, messengerUrl, instagramUrl }: GameCardProps) {
  const { location, city, time, cancelled, status, positions } = game

  return (
    <div
      className={`bg-[#1a1d2e] border border-[#252840] rounded-[14px] p-3.5 mb-2.5 ${
        cancelled ? 'opacity-45' : ''
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-1">
        <span
          className={`text-[15px] font-bold text-[#f1f5f9] ${
            cancelled ? 'line-through text-[#94a3b8]' : ''
          }`}
        >
          {location}
        </span>
        <StatusBadge status={status} />
      </div>

      {/* Meta */}
      <p className="text-[12px] text-[#64748b] mb-3">
        {time} · {city}
      </p>

      {/* Position grid */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {positions.map(pos => (
          <PositionSlot key={pos.name} position={pos} />
        ))}
      </div>

      {/* Inquiry row — hidden for cancelled games */}
      {!cancelled && (
        <div className="flex items-center gap-2 pt-2.5 border-t border-[#252840]">
          <span className="text-[11px] text-[#64748b] flex-1">
            Interested? Contact admin
          </span>
          <a
            href={messengerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="h-7 px-2.5 rounded-full bg-[#0084ff] flex items-center gap-1.5 text-[11px] font-semibold text-white"
          >
            <MessengerIcon />
            Messenger
          </a>
          <a
            href={instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="h-7 px-2.5 rounded-full flex items-center gap-1.5 text-[11px] font-semibold text-white"
            style={{
              background: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
            }}
          >
            <InstagramIcon />
            Instagram
          </a>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/game-card.tsx
git commit -m "feat: add GameCard component with position grid and inquiry row"
```

---

### Task 10: DayGroup, WeekNavigator, ContactBar components

**Files:**
- Create: `src/components/day-group.tsx`
- Create: `src/components/week-navigator.tsx`
- Create: `src/components/contact-bar.tsx`

- [ ] **Step 1: Create DayGroup**

```tsx
// src/components/day-group.tsx
import { DaySchedule } from '@/lib/types'
import { GameCard } from './game-card'

interface DayGroupProps {
  day: DaySchedule
  messengerUrl: string
  instagramUrl: string
}

export function DayGroup({ day, messengerUrl, instagramUrl }: DayGroupProps) {
  return (
    <div>
      <h2 className="text-[11px] font-bold tracking-widest text-[#6366f1] uppercase px-1 pt-3.5 pb-2">
        {day.date}
      </h2>
      {day.games.map(game => (
        <GameCard
          key={game.id}
          game={game}
          messengerUrl={messengerUrl}
          instagramUrl={instagramUrl}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create WeekNavigator**

```tsx
// src/components/week-navigator.tsx

interface WeekNavigatorProps {
  weekNumber: number
  dateRange: string
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}

export function WeekNavigator({
  weekNumber,
  dateRange,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: WeekNavigatorProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2535] bg-[#161824]">
      <button
        onClick={onPrev}
        disabled={!canPrev}
        className="w-[30px] h-[30px] rounded-lg bg-[#1e2535] text-[#94a3b8] text-lg flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Previous week"
      >
        ‹
      </button>
      <div className="text-center">
        <p className="text-[16px] font-bold text-[#f1f5f9]">Week {weekNumber}</p>
        {dateRange && (
          <p className="text-[12px] text-[#64748b] mt-0.5">{dateRange}</p>
        )}
      </div>
      <button
        onClick={onNext}
        disabled={!canNext}
        className="w-[30px] h-[30px] rounded-lg bg-[#1e2535] text-[#94a3b8] text-lg flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Next week"
      >
        ›
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create ContactBar**

```tsx
// src/components/contact-bar.tsx

const MessengerIcon = () => (
  <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] fill-white">
    <path d="M12 2C6.477 2 2 6.145 2 11.259c0 2.84 1.275 5.381 3.306 7.165v3.576l3.285-1.8c.877.24 1.808.37 2.768.37 5.523 0 10-4.144 10-9.259C22 6.146 17.523 2 12 2zm1.07 12.483-2.549-2.67-4.976 2.67 5.474-5.804 2.612 2.67 4.913-2.67-5.474 5.804z" />
  </svg>
)

const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] fill-white">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
  </svg>
)

export function ContactBar() {
  const messengerUrl = process.env.NEXT_PUBLIC_CONTACT_MESSENGER_URL ?? '#'
  const instagramUrl = process.env.NEXT_PUBLIC_CONTACT_INSTAGRAM_URL ?? '#'

  return (
    <div className="flex items-center gap-2">
      <a
        href={messengerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #0084ff, #0052cc)' }}
        aria-label="Contact on Messenger"
      >
        <MessengerIcon />
      </a>
      <a
        href={instagramUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          background: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
        }}
        aria-label="Contact on Instagram"
      >
        <InstagramIcon />
      </a>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/day-group.tsx src/components/week-navigator.tsx src/components/contact-bar.tsx
git commit -m "feat: add DayGroup, WeekNavigator, and ContactBar components"
```

---

### Task 11: Main page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace default page.tsx with dashboard**

```tsx
// src/app/page.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { WeekSchedule, WeekInfo } from '@/lib/types'
import { WeekNavigator } from '@/components/week-navigator'
import { DayGroup } from '@/components/day-group'
import { ContactBar } from '@/components/contact-bar'

export default function Page() {
  const [weeks, setWeeks] = useState<WeekInfo[]>([])
  const [weekIndex, setWeekIndex] = useState<number>(-1)
  const [schedule, setSchedule] = useState<WeekSchedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const messengerUrl = process.env.NEXT_PUBLIC_CONTACT_MESSENGER_URL ?? '#'
  const instagramUrl = process.env.NEXT_PUBLIC_CONTACT_INSTAGRAM_URL ?? '#'

  const fetchSchedule = useCallback(async (weekId: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/schedule?week=${weekId}`)
      const data: WeekSchedule = await res.json()
      setSchedule(data)
      setLastUpdated(new Date())
    } finally {
      setLoading(false)
    }
  }, [])

  // On mount: fetch week list and default to the last (highest) week
  useEffect(() => {
    async function loadWeeks() {
      const res = await fetch('/api/weeks')
      const data: { weeks: WeekInfo[] } = await res.json()
      setWeeks(data.weeks)
      if (data.weeks.length > 0) {
        setWeekIndex(data.weeks.length - 1)
      } else {
        setLoading(false)
      }
    }
    loadWeeks()
  }, [])

  // Fetch schedule whenever selected week changes
  useEffect(() => {
    if (weekIndex < 0 || weeks.length === 0) return
    fetchSchedule(weeks[weekIndex].id)
  }, [weekIndex, weeks, fetchSchedule])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (weekIndex < 0 || weeks.length === 0) return
    const interval = setInterval(() => {
      fetchSchedule(weeks[weekIndex].id)
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [weekIndex, weeks, fetchSchedule])

  const selectedWeek = weeks[weekIndex] ?? null

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col">
      {/* Header */}
      <header className="bg-[#13151f] border-b border-[#1e2535] px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <span className="text-[22px]">🏐</span>
          <div>
            <h1 className="text-[17px] font-bold text-[#f1f5f9] leading-tight">
              DVC Fun Games
            </h1>
            <p className="text-[11px] text-[#64748b]">Available positions this week</p>
          </div>
        </div>
        <ContactBar />
      </header>

      {/* Week navigator — shown only when data is loaded */}
      {selectedWeek && schedule && (
        <WeekNavigator
          weekNumber={selectedWeek.weekNumber}
          dateRange={schedule.dateRange}
          canPrev={weekIndex > 0}
          canNext={weekIndex < weeks.length - 1}
          onPrev={() => setWeekIndex(i => i - 1)}
          onNext={() => setWeekIndex(i => i + 1)}
        />
      )}

      {/* Content */}
      <main className="flex-1 px-3 pb-6 max-w-[480px] w-full mx-auto">
        {loading && (
          <div className="flex items-center justify-center py-16 text-[#64748b] text-sm">
            Loading schedule...
          </div>
        )}

        {!loading && (!schedule || schedule.days.length === 0) && (
          <div className="flex items-center justify-center py-16 text-[#64748b] text-sm">
            No games scheduled for this week.
          </div>
        )}

        {!loading && schedule && schedule.days.map(day => (
          <DayGroup
            key={day.date}
            day={day}
            messengerUrl={messengerUrl}
            instagramUrl={instagramUrl}
          />
        ))}
      </main>

      {/* Footer */}
      <footer className="text-center text-[11px] text-[#334155] py-3 border-t border-[#1e2535] bg-[#13151f]">
        {lastUpdated
          ? `Last updated: ${lastUpdated.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })} · refreshes every 5 min`
          : 'Loading...'}
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Run dev server and verify the UI renders**

```bash
npm run dev
```

Open `http://localhost:3000`. With real credentials in `.env.local`, the full schedule should appear. Without credentials, it will show the loading state.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: implement dashboard page with week navigation and auto-refresh"
```

---

### Task 12: Root layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Update layout.tsx**

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DVC Fun Games',
  description: 'Available positions for DVC Fun Games volleyball sessions this week.',
  themeColor: '#0f1117',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Run build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: set app metadata and root layout"
```

---

### Task 13: Deploy to Vercel

**Files:**
- No new files — Vercel auto-detects Next.js.

- [ ] **Step 1: Push to GitHub**

```bash
# Create a new GitHub repo named dvc-schedule, then:
git remote add origin https://github.com/<your-username>/dvc-schedule.git
git push -u origin main
```

- [ ] **Step 2: Import project in Vercel**

1. Go to [vercel.com](https://vercel.com) → Add New Project
2. Import `dvc-schedule` from GitHub
3. Framework preset: **Next.js** (auto-detected)
4. Click **Deploy** (first deploy will fail — environment variables not set yet)

- [ ] **Step 3: Add environment variables in Vercel**

Go to Project → Settings → Environment Variables. Add these (all environments):

| Name | Value |
|------|-------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `your-sa@project.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | The full private key string. In Vercel UI, paste with literal `\n` — Vercel handles newlines correctly. |
| `NEXT_PUBLIC_CONTACT_MESSENGER_URL` | `https://m.me/your-page` |
| `NEXT_PUBLIC_CONTACT_INSTAGRAM_URL` | `https://instagram.com/your-username` |

- [ ] **Step 4: Redeploy**

In Vercel → Deployments → click the latest → Redeploy.

Expected: Site loads at `https://dvc-schedule.vercel.app` with live data.

- [ ] **Step 5: Share all weekly Google Sheets with the service account**

For each weekly spreadsheet URL, open it → Share → paste the service account email → set to Viewer → Done.

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Drive search for weekly sheets | Task 4 `searchWeeklySheets` + Task 5 |
| Game Schedule tab parsing | Task 4 `buildWeekSchedule` |
| Registration tab matching | Task 4 `parseRegistrationTabName` + `makeGameKey` |
| Position formula (Teams × 2/1) | Task 3 `computeNeeded` |
| Available = Needed − Filled | Task 4 `buildWeekSchedule` positions loop |
| Status badge logic | Task 3 `computeGameStatus` + Task 7 |
| Position slot color (green/orange/red) | Task 8 |
| Game cards with position grid | Task 9 |
| Cancelled game (dimmed, strikethrough, no inquiry) | Task 9 |
| Per-game Messenger + Instagram inquiry | Task 9 |
| Global Messenger + Instagram header bar | Task 10 ContactBar |
| Week navigator prev/next | Task 10 WeekNavigator |
| Auto-refresh every 5 min | Task 11 `setInterval` |
| Last updated timestamp footer | Task 11 |
| Missing registration tab → filled=0 | Task 4 (tab not found → filled stays 0) |
| Env vars for credentials | Task 1 `.env.example` + Task 13 |
| Vercel deployment | Task 13 |

All spec requirements are covered. No gaps found.

**Placeholder scan:** No TBDs, no "similar to Task N", all code blocks are complete. ✓

**Type consistency:**
- `WeekInfo`, `WeekSchedule`, `Game`, `Position`, `DaySchedule`, `GameStatus`, `PositionName`, `POSITION_NAMES` — all defined in `types.ts` (Task 2) and referenced consistently across `parse.ts` (Task 3), `sheets.ts` (Task 4), components (Tasks 7–10), and `page.tsx` (Task 11). ✓
- `messengerUrl` / `instagramUrl` passed as props from `page.tsx` → `DayGroup` → `GameCard`. `ContactBar` reads directly from `process.env.NEXT_PUBLIC_*`. ✓
