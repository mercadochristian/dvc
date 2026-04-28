import { describe, it, expect } from 'vitest'
import {
  parseWeekNumber,
  computeNeeded,
  computeGameStatus,
  computeAvailableTeams,
  buildDateRange,
  makeGameKey,
  parseRegistrationTabName,
  formatDayLabel,
  isDatePast,
} from '@/lib/parse'
import { Position, PositionName } from '@/lib/types'

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
  it('returns cancelled when cancelled and past date — cancelled wins over done', () => {
    expect(computeGameStatus([{ available: 5 }], true, true)).toBe('cancelled')
  })
  it('returns done when isPastDate is true and not cancelled', () => {
    expect(computeGameStatus([{ available: 8 }], false, true)).toBe('done')
  })
  it('returns done regardless of availability when isPastDate is true', () => {
    expect(
      computeGameStatus([{ available: 0 }, { available: 0 }, { available: 0 }, { available: 0 }], false, true)
    ).toBe('done')
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

function makePositions(available: Record<PositionName, number>): Position[] {
  return (Object.keys(available) as PositionName[]).map(name => ({
    name,
    needed: 0,
    filled: 0,
    available: available[name],
  }))
}

describe('computeAvailableTeams', () => {
  it('returns correct count when all positions have ample availability', () => {
    const positions = makePositions({
      'Open Spiker': 8, 'Opposite Spiker': 4, 'Middle Blocker': 8, 'Setter': 4,
    })
    expect(computeAvailableTeams(positions)).toBe(4)
  })

  it('returns 0 when any position has 0 available', () => {
    const positions = makePositions({
      'Open Spiker': 8, 'Opposite Spiker': 0, 'Middle Blocker': 8, 'Setter': 4,
    })
    expect(computeAvailableTeams(positions)).toBe(0)
  })

  it('returns 1 at exact boundary', () => {
    const positions = makePositions({
      'Open Spiker': 2, 'Opposite Spiker': 1, 'Middle Blocker': 2, 'Setter': 1,
    })
    expect(computeAvailableTeams(positions)).toBe(1)
  })

  it('returns the minimum bottleneck', () => {
    const positions = makePositions({
      'Open Spiker': 4, 'Opposite Spiker': 1, 'Middle Blocker': 4, 'Setter': 3,
    })
    expect(computeAvailableTeams(positions)).toBe(1)
  })

  it('returns 0 when Open Spiker is 1 (needs 2 per team)', () => {
    const positions = makePositions({
      'Open Spiker': 1, 'Opposite Spiker': 4, 'Middle Blocker': 8, 'Setter': 4,
    })
    expect(computeAvailableTeams(positions)).toBe(0)
  })

  it('returns 0 when Middle Blocker is 1 (needs 2 per team)', () => {
    const positions = makePositions({
      'Open Spiker': 8, 'Opposite Spiker': 4, 'Middle Blocker': 1, 'Setter': 4,
    })
    expect(computeAvailableTeams(positions)).toBe(0)
  })
})

describe('isDatePast', () => {
  // 2026-04-14 08:00 UTC = April 14, 16:00 Manila → "today" is April 14 in Manila
  const now = new Date('2026-04-14T08:00:00Z')

  it('returns true for a date before today', () => {
    expect(isDatePast('April 13, 2026', now)).toBe(true)
  })
  it('returns false for today', () => {
    expect(isDatePast('April 14, 2026', now)).toBe(false)
  })
  it('returns false for a future date', () => {
    expect(isDatePast('April 15, 2026', now)).toBe(false)
  })
  it('returns true for a date far in the past', () => {
    expect(isDatePast('January 1, 2025', now)).toBe(true)
  })
  it('returns false for an unparseable date string', () => {
    expect(isDatePast('not-a-date', now)).toBe(false)
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
