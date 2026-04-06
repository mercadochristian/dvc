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
  it('returns almost_full when total available slots across all positions is ≤ 4', () => {
    expect(
      computeGameStatus([{ available: 2 }, { available: 0 }, { available: 1 }, { available: 1 }], false)
    ).toBe('almost_full')
  })
  it('returns open when total available slots is more than 4', () => {
    expect(
      computeGameStatus([{ available: 8 }, { available: 1 }, { available: 8 }, { available: 4 }], false)
    ).toBe('open')
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
