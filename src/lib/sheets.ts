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

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

interface CacheEntry<T> {
  data: T
  expires: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new Map<string, CacheEntry<any>>()

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry || Date.now() > entry.expires) return null
  return entry.data as T
}

function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL })
}

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
 * Searches for files whose name contains 'DVC Fun Games Registration'.
 * Returns sorted ascending by week number. Filters out files with no
 * parseable week number.
 */
export async function searchWeeklySheets(): Promise<WeekInfo[]> {
  const cached = getCached<WeekInfo[]>('weeks')
  if (cached) return cached

  const auth = getAuthClient()
  const drive = google.drive({ version: 'v3', auth })
  const res = await drive.files.list({
    q: `name contains 'DVC Fun Games Registration' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 100,
  })
  const files = res.data.files ?? []
  const valid = files
    .filter(f => f.id && f.name && parseWeekNumber(f.name) > 0)
    .map(f => ({
      id: f.id!,
      name: f.name!,
      weekNumber: parseWeekNumber(f.name!),
    }))
    .sort((a, b) => a.weekNumber - b.weekNumber)

  const firstDates = await Promise.all(valid.map(f => getFirstGameDate(f.id)))
  const result = valid.map((f, i) => ({ ...f, firstDate: firstDates[i] }))
  setCached('weeks', result)
  return result
}

/**
 * Read values from a specific sheet range.
 * Returns a 2D array of strings. Empty cells become empty strings.
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
 * Read the first game date from a spreadsheet's Game Schedule tab.
 * Returns null if the tab is missing, malformed, or has no data rows.
 */
async function getFirstGameDate(spreadsheetId: string): Promise<string | null> {
  try {
    const rows = await getSheetValues(spreadsheetId, 'Game Schedule!1:2')
    if (rows.length < 2) return null
    const headers = rows[0].map(h => h.toLowerCase().trim())
    const dateCol = headers.indexOf('date')
    if (dateCol < 0) return null
    return rows[1][dateCol]?.trim() || null
  } catch {
    return null
  }
}

/**
 * Get all tab (sheet) names in a spreadsheet.
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
 *
 * Reads:
 * 1. All tab names (to find registration tabs)
 * 2. The "Game Schedule" tab (to get game rows)
 * 3. Each matching registration tab (to count filled positions)
 *
 * If a registration tab does not exist for a game, filled defaults to 0
 * (all slots shown as available).
 */
export async function buildWeekSchedule(
  spreadsheetId: string,
  weekNumber: number
): Promise<WeekSchedule> {
  const cacheKey = `schedule:${spreadsheetId}`
  const cached = getCached<WeekSchedule>(cacheKey)
  if (cached) return cached
  // 1. Get all tab names for matching
  const tabNames = await getSheetTabNames(spreadsheetId)

  // 2. Read Game Schedule tab (row 0 = headers, rows 1+ = data)
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

  // 3. Build map: normalized game key → registration tab name
  const tabKeyMap = new Map<string, string>()
  for (const tabName of tabNames) {
    const parsed = parseRegistrationTabName(tabName)
    if (parsed) {
      tabKeyMap.set(makeGameKey(parsed.date, parsed.location, parsed.time), tabName)
    }
  }

  // 4. Process each game row
  const allDates: string[] = []
  // Map preserves insertion order (= sheet row order = date order)
  const dayMap = new Map<string, Game[]>()
  for (const row of rows) {
    const date = row[dateCol]?.trim() ?? ''
    const location = row[locationCol]?.trim() ?? ''
    const time = row[timeCol]?.trim() ?? ''
    const teams = Number.parseInt(row[teamsCol] ?? '0', 10) || 0
    const city = row[cityCol]?.trim() ?? ''
    const statusVal = row[statusCol]?.trim() ?? ''

    if (!date || !location) continue
    allDates.push(date)

    const cancelled = statusVal.toLowerCase() === 'cancelled'
    const needed = computeNeeded(teams)

    // Find matching registration tab
    const gameKey = makeGameKey(date, location, time)
    const matchingTab = tabKeyMap.get(gameKey)

    // Count filled positions from registration tab
    const filled: Record<PositionName, number> = {
      'Open Spiker': 0,
      'Opposite Spiker': 0,
      'Middle Blocker': 0,
      'Setter': 0,
    }
    if (matchingTab) {
      // Wrap tab name in single quotes to handle spaces/special chars
      const safeRange = `'${matchingTab.replace(/'/g, "\\'")}'`
      const regValues = await getSheetValues(spreadsheetId, safeRange)
      if (regValues.length >= 2) {
        // Headers are at row 2 (index 1); row 1 (index 0) is unused/empty
        const regHeaders = regValues[1].map(h => h.toLowerCase().trim())
        const posCol = regHeaders.indexOf('position')
        if (posCol >= 0) {
          for (const regRow of regValues.slice(2)) {
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
    const gameId = `${date}-${location}`
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')

    const game: Game = { id: gameId, location, city, time, cancelled, status, positions }

    if (!dayMap.has(date)) dayMap.set(date, [])
    dayMap.get(date)!.push(game)
  }

  // 5. Assemble days
  const days: DaySchedule[] = Array.from(dayMap.entries()).map(([date, games]) => ({
    date: formatDayLabel(date),
    games,
  }))

  const result: WeekSchedule = {
    weekNumber,
    dateRange: buildDateRange(allDates),
    days,
  }
  setCached(cacheKey, result)
  return result
}
