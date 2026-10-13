import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/sheets', () => ({
  searchWeeklySheets: vi.fn(),
  getRegisteredPlayers: vi.fn(),
}))

import { searchWeeklySheets, getRegisteredPlayers } from '@/lib/sheets'
import { GET } from '@/app/api/registered-players/route'

const request = (query: string) =>
  new NextRequest(`http://localhost/api/registered-players?${query}`)

describe('GET /api/registered-players', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'test@example.com')
    vi.stubEnv('GOOGLE_PRIVATE_KEY', 'test-key')
    vi.mocked(searchWeeklySheets).mockResolvedValue([{
      id: 'week-1', name: 'Week 1', weekNumber: 1, firstDate: null, lastDate: null,
    }])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('rejects a request missing game identity', async () => {
    const response = await GET(request('week=week-1'))
    expect(response.status).toBe(400)
  })

  it('rejects spreadsheet IDs outside the published week list', async () => {
    const response = await GET(request(
      'week=private-id&date=April%2014%2C%202026&location=Court&time=6PM',
    ))
    expect(response.status).toBe(404)
    expect(getRegisteredPlayers).not.toHaveBeenCalled()
  })

  it('returns only the requested roster with no HTTP cache', async () => {
    vi.mocked(getRegisteredPlayers).mockResolvedValue({
      groups: [{ position: 'Setter', players: [{ firstName: 'Ana', count: 1 }] }],
      fetchedAt: '2026-10-13T00:00:00.000Z',
    })
    const response = await GET(request(
      'week=week-1&date=April%2014%2C%202026&location=Court&time=6PM',
    ))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      groups: [{ position: 'Setter', players: [{ firstName: 'Ana', count: 1 }] }],
      fetchedAt: '2026-10-13T00:00:00.000Z',
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(getRegisteredPlayers).toHaveBeenCalledWith('week-1', {
      date: 'April 14, 2026', location: 'Court', time: '6PM',
    })
  })
})
