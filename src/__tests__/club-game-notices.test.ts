import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/club/server/gateway', () => ({
  ORG: 'test-org',
  db: vi.fn(),
}))

import { POST } from '@/app/api/club/game-notices/route'
import { deliverGameNotices } from '@/features/club/server/game-notices'
import { db } from '@/features/club/server/gateway'

const notice = {
  id: 'notice-one',
  lease_token: 'lease-one',
  recipient: 'player@example.test',
  venue: 'Training Hall',
  event: 'rescheduled',
  old_starts_at: '2026-11-08T10:00:00Z',
  old_ends_at: '2026-11-08T12:00:00Z',
  starts_at: '2026-11-08T11:00:00Z',
  ends_at: '2026-11-08T13:00:00Z',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('DVC_GAME_MAIL_FROM', 'DVC <club@example.test>')
  vi.stubEnv('DVC_GAME_MAIL_TEST_URL', 'http://127.0.0.1:5999/email')
  vi.stubEnv('DVC_GAME_MAIL_WORKER_SECRET', 's'.repeat(32))
  vi.mocked(db).mockResolvedValueOnce([notice]).mockResolvedValueOnce(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('game notice worker', () => {
  it('requires the worker credential before claiming messages', async () => {
    const result = await POST(new Request('http://localhost/api/club/game-notices', { method: 'POST' }))
    expect(result.status).toBe(401)
    expect(db).not.toHaveBeenCalled()
  })

  it('preserves pending mail when the provider is unconfigured', async () => {
    vi.stubEnv('DVC_GAME_MAIL_TEST_URL', '')
    expect(await deliverGameNotices()).toBeNull()
    expect(db).not.toHaveBeenCalled()
  })

  it('sends a private Manila-time update with the stable key and settles its lease', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'provider-one' }))
    vi.stubGlobal('fetch', send)
    expect(await deliverGameNotices()).toEqual({ sent: 1, retryRequested: 0, deferred: 0, error: 0, unsettled: 0 })
    const [url, request] = send.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:5999/email')
    expect(request?.headers).toMatchObject({ 'Idempotency-Key': 'dvc-game-notice/notice-one' })
    const email = JSON.parse(String(request?.body))
    expect(email.to).toEqual([notice.recipient])
    expect(email.text).toMatch(/Previous schedule: .*6:00 PM to .*8:00 PM Manila time\nNew schedule: .*7:00 PM/)
    expect(db).toHaveBeenLastCalledWith('rpc/dvc_finish_game_notice', expect.objectContaining({
      body: JSON.stringify({ p_org: 'test-org', p_id: notice.id, p_lease: notice.lease_token, p_outcome: 'sent' }),
    }))
  })

  it('sends cancellation details without promising a refund', async () => {
    vi.mocked(db).mockReset().mockResolvedValueOnce([{ ...notice, event: 'cancelled' }]).mockResolvedValueOnce(true)
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'provider-one' }))
    vi.stubGlobal('fetch', send)
    expect(await deliverGameNotices()).toMatchObject({ sent: 1 })
    const email = JSON.parse(String(send.mock.calls[0][1]?.body))
    expect(email).toMatchObject({ subject: 'DVC game cancelled', text: expect.stringContaining('Training Hall') })
    expect(email.text).toContain('contact the club about next steps')
  })

  it.each([[429, 'retryRequested'], [403, 'deferred'], [422, 'error']] as const)('records provider response %s as %s', async (status, outcome) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
    expect(await deliverGameNotices()).toMatchObject({ [outcome]: 1 })
  })
})
