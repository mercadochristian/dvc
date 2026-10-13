import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/sheet-cache', () => ({ invalidateRegistrationCache: vi.fn() }))
import { invalidateRegistrationCache } from '@/lib/sheet-cache'
import { POST } from '@/app/api/registrations/updated/route'

const spreadsheetId = 'published-week-123'
const scheduleOption = '10-13-26 - San Carlos Seminary (Tue, 6:30PM-9:30PM)'
const request = (body: unknown, key = 'test-secret') => new NextRequest(
  'http://localhost/api/registrations/updated', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-registration-key': key },
    body: JSON.stringify(body),
  },
)

describe('registration update webhook', () => {
  beforeEach(() => {
    vi.stubEnv('REGISTRATION_WEBHOOK_SECRET', 'test-secret')
    vi.clearAllMocks()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('rejects an incorrect secret before invalidating any cache', async () => {
    expect((await POST(request({ spreadsheetId, scheduleOption }, 'wrong'))).status).toBe(401)
    expect(invalidateRegistrationCache).not.toHaveBeenCalled()
  })

  it('disables the endpoint when its secret is missing', async () => {
    vi.stubEnv('REGISTRATION_WEBHOOK_SECRET', '')
    expect((await POST(request({ spreadsheetId, scheduleOption }))).status).toBe(503)
  })

  it.each([
    null,
    {},
    { spreadsheetId: '../private', scheduleOption },
    { spreadsheetId, scheduleOption: 'not a game' },
    { spreadsheetId, scheduleOption: 7 },
  ])('rejects invalid game details: %j', async body => {
    expect((await POST(request(body))).status).toBe(400)
    expect(invalidateRegistrationCache).not.toHaveBeenCalled()
  })

  it('expires only the affected game roster and weekly schedule', async () => {
    const response = await POST(request({ spreadsheetId, scheduleOption }))
    expect(response.status).toBe(200)
    expect(invalidateRegistrationCache).toHaveBeenCalledWith(spreadsheetId, {
      date: 'October 13, 2026', location: 'San Carlos Seminary', time: '6:30PM-9:30PM',
    })
    expect(await response.json()).toEqual({ revalidated: true })
  })

  it('accepts duplicate notifications without registering another player', async () => {
    const statuses = await Promise.all([1, 2].map(async () =>
      (await POST(request({ spreadsheetId, scheduleOption }))).status,
    ))
    expect(statuses).toEqual([200, 200])
  })

  it('rejects malformed JSON', async () => {
    const response = await POST(new NextRequest('http://localhost/api/registrations/updated', {
      method: 'POST', headers: { 'x-registration-key': 'test-secret' }, body: '{broken',
    }))
    expect(response.status).toBe(400)
  })

  it('returns a retryable error when tag invalidation fails', async () => {
    vi.mocked(invalidateRegistrationCache).mockImplementationOnce(() => { throw new Error('cache unavailable') })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect((await POST(request({ spreadsheetId, scheduleOption }))).status).toBe(503)
    } finally {
      log.mockRestore()
    }
  })
})
