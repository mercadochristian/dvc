import { beforeEach, describe, expect, it, vi } from 'vitest'

const googleCalls = vi.hoisted(() => ({
  tabList: vi.fn(),
  valuesGet: vi.fn(),
  valuesBatchGet: vi.fn(),
  filesList: vi.fn(),
  cacheEntries: new Map<string, { value: unknown; tags: string[] }>(),
  backgroundRefresh: false,
  backgroundTasks: [] as Promise<unknown>[],
}))

vi.mock('next/cache', () => ({
  unstable_cache: (load: () => Promise<unknown>, keys: string[], options: { tags: string[] }) =>
    async () => {
      const key = JSON.stringify(keys)
      const cached = googleCalls.cacheEntries.get(key)
      if (cached) {
        if (googleCalls.backgroundRefresh) googleCalls.backgroundTasks.push(load())
        return cached.value
      }
      const value = await load()
      googleCalls.cacheEntries.set(key, { value, tags: options.tags })
      return value
    },
  revalidateTag: vi.fn((tag: string) => {
    for (const [key, entry] of googleCalls.cacheEntries) {
      if (entry.tags.includes(tag)) googleCalls.cacheEntries.delete(key)
    }
  }),
}))

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class {} },
    drive: () => ({ files: { list: googleCalls.filesList } }),
    sheets: () => ({
      spreadsheets: {
        get: googleCalls.tabList,
        values: {
          get: googleCalls.valuesGet,
          batchGet: googleCalls.valuesBatchGet,
        },
      },
    }),
  },
}))

import { buildWeekSchedule, clearCache, getRegisteredPlayers, searchWeeklySheets } from '@/lib/sheets'
import { invalidateRegistrationCache } from '@/lib/sheet-cache'
import { revalidateTag } from 'next/cache'

const tabA = '01-12-27 - Court A (Tue, 6:00PM-8:00PM)'
const tabB = '01-13-27 - Court B (Wed, 6:00PM-8:00PM)'
const scheduleRows = [
  ['Date', 'Location', 'Time', 'Teams', 'City', 'Status'],
  ['January 12, 2027', 'Court A', '6:00PM-8:00PM', '1', 'Makati', ''],
  ['January 13, 2027', 'Court B', '6:00PM-8:00PM', '1', 'Makati', ''],
]
const registrationRows = (name: string, position: string) => [
  [],
  ['First Name', 'Position'],
  [name, position],
]

describe('buildWeekSchedule Google Sheets quota', () => {
  beforeEach(() => {
    clearCache()
    vi.clearAllMocks()
    googleCalls.backgroundRefresh = false
    googleCalls.backgroundTasks = []
    googleCalls.tabList.mockResolvedValue({
      data: { sheets: [
        { properties: { title: 'Game Schedule' } },
        { properties: { title: tabA } },
        { properties: { title: tabB } },
      ] },
    })
    googleCalls.valuesGet.mockImplementation(() => {
      throw new Error('individual values.get call consumed quota')
    })
    googleCalls.valuesBatchGet.mockResolvedValue({
      data: { valueRanges: [
        { values: scheduleRows },
        { values: registrationRows('Ana', 'Setter') },
        { values: registrationRows('Ben', 'Open Spiker') },
      ] },
    })
  })

  it('reads the schedule and registration tabs in one values request', async () => {
    const schedule = await buildWeekSchedule('week-1', 1)

    expect(schedule.days[0].games[0].positions.find(p => p.name === 'Setter')?.filled).toBe(1)
    expect(schedule.days[1].games[0].positions.find(p => p.name === 'Open Spiker')?.filled).toBe(1)
    expect(googleCalls.valuesBatchGet).toHaveBeenCalledTimes(1)
    expect(googleCalls.valuesGet).not.toHaveBeenCalled()
  })

  it('shares one Sheets read across concurrent schedule requests', async () => {
    await Promise.all([
      buildWeekSchedule('week-2', 2),
      buildWeekSchedule('week-2', 2),
    ])

    expect(googleCalls.tabList).toHaveBeenCalledTimes(1)
    expect(googleCalls.valuesBatchGet).toHaveBeenCalledTimes(1)
  })

  it('shares one roster read for 10 simultaneous viewers', async () => {
    googleCalls.valuesGet.mockResolvedValue({ data: { values: registrationRows('Ana', 'Setter') } })
    const game = { date: 'January 12, 2027', location: 'Court A', time: '6:00PM-8:00PM' }
    await Promise.all(Array.from({ length: 10 }, () => getRegisteredPlayers('week-1', game)))
    expect(googleCalls.valuesGet).toHaveBeenCalledTimes(1)
  })

  it('expires the affected roster and schedule while keeping another game cached', async () => {
    googleCalls.valuesGet.mockResolvedValue({ data: { values: registrationRows('Ana', 'Setter') } })
    const gameA = { date: 'January 12, 2027', location: 'Court A', time: '6:00PM-8:00PM' }
    const gameB = { date: 'January 13, 2027', location: 'Court B', time: '6:00PM-8:00PM' }
    await getRegisteredPlayers('week-1', gameA)
    const beforeB = await getRegisteredPlayers('week-1', gameB)
    await buildWeekSchedule('week-1', 1)

    invalidateRegistrationCache('week-1', gameA)
    googleCalls.valuesGet.mockResolvedValue({ data: { values: [
      ...registrationRows('Ana', 'Setter'), ['Ben', 'Setter'],
    ] } })
    const updated = await getRegisteredPlayers('week-1', gameA)
    expect(updated.groups[3].players).toHaveLength(2)
    expect(await getRegisteredPlayers('week-1', gameB)).toEqual(beforeB)
    expect(googleCalls.valuesGet).toHaveBeenCalledTimes(3)
    await buildWeekSchedule('week-1', 1)
    expect(googleCalls.valuesBatchGet).toHaveBeenCalledTimes(2)
    expect(revalidateTag).toHaveBeenCalledWith(expect.any(String), { expire: 0 })
  })

  it('coalesces cold weekly-sheet lookups across 10 viewers', async () => {
    googleCalls.filesList.mockResolvedValue({ data: { files: [
      { id: 'week-1', name: 'DVC Fun Games Registration Week 1' },
    ] } })
    googleCalls.valuesGet.mockResolvedValue({ data: { values: scheduleRows } })
    await Promise.all(Array.from({ length: 10 }, () => searchWeeklySheets()))
    expect(googleCalls.filesList).toHaveBeenCalledTimes(1)
    expect(googleCalls.valuesGet).toHaveBeenCalledTimes(1)
  })

  it('coalesces overlapping background refreshes of a stale roster', async () => {
    const game = { date: 'January 12, 2027', location: 'Court A', time: '6:00PM-8:00PM' }
    googleCalls.valuesGet.mockResolvedValue({ data: { values: registrationRows('Ana', 'Setter') } })
    await getRegisteredPlayers('week-1', game)
    let resolve!: (value: unknown) => void
    googleCalls.valuesGet.mockImplementation(() => new Promise(done => { resolve = done }))
    googleCalls.backgroundRefresh = true
    await getRegisteredPlayers('week-1', game)
    await getRegisteredPlayers('week-1', game)
    // Allow the nested cached tab lookup to finish before inspecting reads.
    await Promise.resolve()
    await Promise.resolve()
    expect(googleCalls.valuesGet).toHaveBeenCalledTimes(2)
    resolve({ data: { values: registrationRows('Ben', 'Setter') } })
    await Promise.all(googleCalls.backgroundTasks)
  })
})
