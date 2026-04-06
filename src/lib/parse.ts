// src/lib/parse.ts
import { GameStatus, PositionName } from './types'

const TZ = 'Asia/Manila'

export function parseLocalDate(dateStr: string): Date | null {
  // Parse "Month Day, Year" (e.g. "April 14, 2026") as a UTC midnight date.
  // All display formatting uses TZ = 'Asia/Manila' so the rendered date is always correct.
  const match = dateStr.match(/^(\w+)\s+(\d+),\s+(\d{4})$/)
  if (!match) return null
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const monthIdx = monthNames.indexOf(match[1])
  if (monthIdx === -1) return null
  // Use UTC noon to avoid any date boundary issues across timezones
  return new Date(Date.UTC(Number.parseInt(match[3]), monthIdx, Number.parseInt(match[2]), 4, 0, 0))
}

export function parseWeekNumber(name: string): number {
  const match = name.match(/Week\s+(\d+)/i)
  if (!match) return 0
  return Number.parseInt(match[1], 10)
}

export function computeNeeded(teams: number): Record<PositionName, number> {
  return {
    'Open Spiker': teams * 2,
    'Opposite Spiker': teams * 1,
    'Middle Blocker': teams * 2,
    'Setter': teams * 1,
  }
}

export function computeGameStatus(
  positions: { available: number }[],
  cancelled: boolean
): GameStatus {
  if (cancelled) return 'cancelled'
  if (positions.every(p => p.available === 0)) return 'full'
  const totalAvailable = positions.reduce((sum, p) => sum + p.available, 0)
  if (totalAvailable <= 4) return 'almost_full'
  return 'open'
}

export function buildDateRange(dates: string[]): string {
  if (dates.length === 0) return ''
  const parsed = dates
    .map(d => parseLocalDate(d))
    .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()))
  if (parsed.length === 0) return ''
  parsed.sort((a, b) => a.getTime() - b.getTime())
  const first = parsed[0]
  const last = parsed[parsed.length - 1]
  const fmtShort = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })
  const year = Number.parseInt(
    last.toLocaleDateString('en-US', { year: 'numeric', timeZone: TZ })
  )
  return `${fmtShort(first)} – ${fmtShort(last)}, ${year}`
}

export function makeGameKey(date: string, location: string, time: string): string {
  return `${date.toLowerCase().trim()}|${location.toLowerCase().trim()}|${time.toLowerCase().trim()}`
}

export function parseRegistrationTabName(tabName: string): {
  date: string
  location: string
  time: string
} | null {
  const match = tabName.match(/^(\d{2})-(\d{2})-(\d{2})\s*-\s*(.+?)\s*\([\w]+,\s*(.+?)\)$/)
  if (!match) return null
  const [, mm, dd, yy, location, time] = match
  const year = 2000 + Number.parseInt(yy, 10)
  // Use UTC noon to avoid date boundary issues; display uses TZ = 'Asia/Manila'
  const date = new Date(Date.UTC(year, Number.parseInt(mm, 10) - 1, Number.parseInt(dd, 10), 4, 0, 0))
  if (isNaN(date.getTime())) return null
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: TZ,
  })
  return { date: dateStr, location: location.trim(), time: time.trim() }
}

export function formatDayLabel(dateStr: string): string {
  const date = parseLocalDate(dateStr)
  if (!date || Number.isNaN(date.getTime())) return dateStr.toUpperCase()
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: TZ }).toUpperCase()
  const month = date.toLocaleDateString('en-US', { month: 'short', timeZone: TZ }).toUpperCase()
  const day = Number.parseInt(date.toLocaleDateString('en-US', { day: 'numeric', timeZone: TZ }))
  return `${weekday}, ${month} ${day}`
}
