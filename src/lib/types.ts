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
