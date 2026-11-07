import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClubError } from '@/features/club/model/validation'
import { identity, rpc } from '@/features/club/server/gateway'
import { GET } from '@/app/api/club/route'

vi.mock('@/features/club/server/gateway', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/club/server/gateway')>(),
  identity: vi.fn(),
  rpc: vi.fn(),
  logFailure: vi.fn(),
}))

const adminId = '11111111-1111-4111-8111-111111111111'
const developerId = '22222222-2222-4222-8222-222222222222'
const checkoutId = '33333333-3333-4333-8333-333333333333'
const time = '2026-11-05T02:00:00.987654+00:00'
const get = (query: Record<string, string> = {}) => GET(new Request(
  `http://localhost/api/club?${new URLSearchParams({ view: 'management-payments', ...query })}`,
))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DVC_SESSION_SECRET', 'test-only-management-payments-secret')
  vi.mocked(identity).mockResolvedValue({ user: { id: adminId }, role: 'admin', developer: false })
  vi.mocked(rpc).mockResolvedValue({ rows: [], next_key: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('global payment history', () => {
  it.each(['coordinator', 'facilitator', 'player'] as const)('denies a %s before invoking payment history', async role => {
    vi.mocked(identity).mockResolvedValue({ user: { id: adminId }, role, developer: false })
    expect((await get()).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('turns a role change between identity lookup and the database read into a 403', async () => {
    vi.mocked(rpc).mockRejectedValueOnce(new ClubError('Payment management access denied', 409, 'CONFLICT'))
    expect((await get()).status).toBe(403)
  })

  it.each<Record<string, string>>([{ limit: '0' }, { limit: '51' }, { query: 'x'.repeat(121) },
    { status: 'settled' }, { after: 'invalid' }, { mode: 'checkout', checkout: 'other' },
    { mode: 'games', date: '2026-02-30' }])('rejects invalid request %j before a database read', async query => {
    expect((await get(query)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('scopes a continuation to normalized filters, actor, size and view and preserves submillisecond ordering', async () => {
    vi.mocked(rpc).mockResolvedValueOnce({ rows: [], next_key: { time, id: checkoutId, kind: 'checkout' } })
    const first = await get({ query: '  Fixture   Court ', status: 'approved', limit: '10' })
    expect(first.headers.get('cache-control')).toBe('private, no-store')
    const { next_cursor: after } = await first.json()
    expect((await get({ query: 'fixture court', status: 'approved', limit: '10', after })).status).toBe(200)
    expect(rpc).toHaveBeenLastCalledWith('dvc_management_payments', expect.objectContaining({
      p_after_time: time, p_after_id: checkoutId, p_after_kind: 'checkout', p_limit: 10,
    }))
    const altered = { query: 'fixture court', status: 'approved', limit: '10', after }
    expect((await get({ ...altered, status: 'missing' })).status).toBe(400)
    expect((await get({ ...altered, limit: '25' })).status).toBe(400)
    expect((await get({ ...altered, mode: 'checkout', checkout: checkoutId })).status).toBe(400)
    vi.mocked(identity).mockResolvedValue({ user: { id: developerId }, role: 'developer', developer: true })
    expect((await get(altered)).status).toBe(400)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('requests checkout lines independently without reloading the list', async () => {
    const response = await get({ mode: 'checkout', checkout: checkoutId })
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('dvc_management_checkout_bookings', expect.objectContaining({
      p_checkout: checkoutId, p_limit: 25, p_user: adminId,
    }))
  })
})
