// src/lib/parse.ts
import { GameStatus, PositionName } from './types'

function parseLocalDate(dateStr: string): Date | null {
  // Parse "Month Day, Year" (e.g. "April 14, 2026") as local date to avoid UTC shift
  const match = dateStr.match(/^(\w+)\s+(\d+),\s+(\d{4})$/)
  if (!match) return null
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const monthIdx = monthNames.indexOf(match[1])
  if (monthIdx === -1) return null
  return new Date(parseInt(match[3]), monthIdx, parseInt(match[2]))
}

export function parseWeekNumber(name: string): number {
  const match = name.match(/Week\s+(\d+)/i)
  if (!match) return 0
  return parseInt(match[1], 10)
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
  if (positions.some(p => p.available <= 2)) return 'almost_full'
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
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const year = last.getFullYear()
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
  const year = 2000 + parseInt(yy, 10)
  const date = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10))
  if (isNaN(date.getTime())) return null
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  return { date: dateStr, location: location.trim(), time: time.trim() }
}

export function formatDayLabel(dateStr: string): string {
  const date = parseLocalDate(dateStr)
  if (!date || Number.isNaN(date.getTime())) return dateStr.toUpperCase()
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
  const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
  const day = date.getDate()
  return `${weekday}, ${month} ${day}`
}
