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
  isDatePast,
  parseLocalDate,
} from './parse'
import {
  emptyRegisteredPlayerGroups,
  findRegistrationTab,
  parseRegisteredPlayers,
  type RegisteredPlayersResponse,
} from './registered-players'
import {
  cachedSheetRead, invalidateAllSheetCaches, rosterCacheTag, scheduleCacheTag,
} from './sheet-cache'

// The week list is a Drive lookup that only changes when a new weekly sheet is
// added (about once a week), so it can be cached aggressively.
const WEEKS_CACHE_TTL = 30 * 60 // seconds
// Per-week schedules carry the live position-availability counts, so they use a
// shorter TTL to feel fresh. Caching the week list longer frees quota budget to
// afford this. Persistent values are shared across viewers; concurrent reads
// on the same instance are also coalesced while a cache miss is being loaded.
const SCHEDULE_CACHE_TTL = 2 * 60 // seconds
const ROSTER_CACHE_TTL = 60 // seconds

/**
 * Expire all persistent Sheets data across Vercel instances.
 * Used by the secret cache-clear endpoint.
 */
export function clearCache(): void {
  invalidateAllSheetCaches()
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
  return cachedSheetRead(['dvc-weeks-v2'], ['dvc-weeks'], WEEKS_CACHE_TTL, searchWeeklySheetsUncached)
}

async function searchWeeklySheetsUncached(): Promise<WeekInfo[]> {
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

  const bounds = await Promise.all(valid.map(f => getGameDateBounds(f.id)))
  const result = valid.map((f, i) => ({
    ...f,
    firstDate: bounds[i].first,
    lastDate: bounds[i].last,
  }))
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

function quoteSheetTab(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`
}

/** Read several tabs in one Sheets read request. Results follow ranges order. */
async function getSheetValueRanges(
  spreadsheetId: string,
  ranges: string[],
): Promise<string[][][]> {
  const auth = getAuthClient()
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges })
  return (res.data.valueRanges ?? []).map(range => (range.values ?? []) as string[][])
}

/**
 * Read the earliest and latest game dates from a spreadsheet's Game Schedule
 * tab. Dates are compared chronologically (not by row order) so an unsorted
 * sheet still yields a correct range. Returns nulls if the tab is missing,
 * malformed, or has no parseable data rows.
 */
async function getGameDateBounds(
  spreadsheetId: string
): Promise<{ first: string | null; last: string | null }> {
  try {
    const rows = await getSheetValues(spreadsheetId, 'Game Schedule')
    if (rows.length < 2) return { first: null, last: null }
    const headers = rows[0].map(h => h.toLowerCase().trim())
    const dateCol = headers.indexOf('date')
    if (dateCol < 0) return { first: null, last: null }

    const dates = rows
      .slice(1)
      .map(r => r[dateCol]?.trim() ?? '')
      .map(raw => ({ raw, parsed: parseLocalDate(raw) }))
      .filter((d): d is { raw: string; parsed: Date } => d.parsed !== null)
    if (dates.length === 0) return { first: null, last: null }

    dates.sort((a, b) => a.parsed.getTime() - b.parsed.getTime())
    return { first: dates[0].raw, last: dates[dates.length - 1].raw }
  } catch {
    return { first: null, last: null }
  }
}

/**
 * Get all tab (sheet) names in a spreadsheet.
 */
async function getSheetTabNames(spreadsheetId: string): Promise<string[]> {
  return cachedSheetRead(['dvc-tabs-v2', spreadsheetId], [], SCHEDULE_CACHE_TTL, async () => {
    const auth = getAuthClient()
    const sheets = google.sheets({ version: 'v4', auth })
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    })
    return (res.data.sheets ?? []).map(s => s.properties?.title ?? '').filter(Boolean)
  })
}

/** Return only first names and positions for one game, on demand. */
export async function getRegisteredPlayers(
  spreadsheetId: string,
  game: { date: string; location: string; time: string },
): Promise<RegisteredPlayersResponse> {
  const cacheKey = makeGameKey(game.date, game.location, game.time)
  return cachedSheetRead(
    ['dvc-roster-v2', spreadsheetId, cacheKey],
    [rosterCacheTag(spreadsheetId, game)],
    ROSTER_CACHE_TTL,
    async () => {
      const tabNames = await getSheetTabNames(spreadsheetId)
      const tabName = findRegistrationTab(tabNames, game.date, game.location, game.time)
      const groups = tabName
        ? parseRegisteredPlayers(await getSheetValues(
            spreadsheetId,
            quoteSheetTab(tabName),
          ))
        : emptyRegisteredPlayerGroups()
      return { groups, fetchedAt: new Date().toISOString() }
    },
  )
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
  return cachedSheetRead(
    ['dvc-schedule-v2', spreadsheetId, String(weekNumber)],
    [scheduleCacheTag(spreadsheetId)],
    SCHEDULE_CACHE_TTL,
    () => buildWeekScheduleUncached(spreadsheetId, weekNumber),
  )
}

async function buildWeekScheduleUncached(
  spreadsheetId: string,
  weekNumber: number,
): Promise<WeekSchedule> {
  // 1. Get all tab names for matching
  const tabNames = await getSheetTabNames(spreadsheetId)

  // 2. Read Game Schedule and every registration tab in one values request.
  const registrationTabs = tabNames.filter(name => parseRegistrationTabName(name) !== null)
  const [scheduleValues = [], ...registrationValues] = await getSheetValueRanges(
    spreadsheetId,
    ['Game Schedule', ...registrationTabs.map(quoteSheetTab)],
  )
  const registrationsByTab = new Map(
    registrationTabs.map((tabName, index) => [tabName, registrationValues[index] ?? []]),
  )
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
      const regValues = registrationsByTab.get(matchingTab) ?? []
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

    const status = computeGameStatus(positions, cancelled, isDatePast(date))
    const gameId = `${date}-${location}-${time}`
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')

    const game: Game = { id: gameId, date, location, city, time, cancelled, status, positions }

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
  return result
}
