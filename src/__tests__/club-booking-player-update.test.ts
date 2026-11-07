import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/features/club/server/gateway', () => ({ configured: vi.fn(), db: vi.fn(), guard: vi.fn(), guest: vi.fn(), identity: vi.fn(), logFailure: vi.fn(), ORG: '00000000-0000-0000-0000-000000000001', rpc: vi.fn() }))
import { guest, identity, logFailure, rpc } from '@/features/club/server/gateway'
import { POST } from '@/app/api/club/route'
import { ClubError, validateBookingPlayerUpdate } from '@/features/club/model/validation'
const id = '11111111-1111-4111-8111-111111111111', entry = '22222222-2222-4222-8222-222222222222'
const positionOnly = () => ({ booking_id: id, entry_id: entry, expected_version: 0, has_details: false, name: null })
const detailed = () => ({ ...positionOnly(), has_details: true, name: 'Ben', level: 'intermediate', gender: 'male', birth_date: '1995-04-12', first_timer: true, email: 'BEN@example.test' })
const request = (data: unknown, origin = 'http://localhost') => new Request('http://localhost/api/club', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'booking.player.update', data }) })
beforeEach(() => { vi.resetAllMocks(); vi.mocked(identity).mockResolvedValue({ user: null, role: 'player', developer: false }); vi.mocked(guest).mockResolvedValue('a'.repeat(64)); vi.mocked(rpc).mockResolvedValue({ id: entry, booking_id: id, has_details: false, name: null, position: 'open' }) })
describe('owner player-detail edit input', () => {
  it('normalizes only a complete opted-in profile', () => expect(validateBookingPlayerUpdate(detailed())).toMatchObject({ has_details: true, email: 'ben@example.test', age: null, birth_date: '1995-04-12' }))
  it('allows explicit clearing without fabricated personal details', () => expect(validateBookingPlayerUpdate(positionOnly())).toEqual({ ...positionOnly(), email: null }))
  it.each(['position','kind','team','game_id','amount','checkout_id','is_registrant','age','version'])('rejects changing %s', key => expect(() => validateBookingPlayerUpdate({ ...positionOnly(), [key]: 1 })).toThrow('Only player details'))
  it.each(['name','level','gender','birth_date','first_timer'])('requires opted-in %s', key => { const value: Record<string, unknown> = detailed(); delete value[key]; expect(() => validateBookingPlayerUpdate(value)).toThrow() })
  it('rejects partial PII under an unchecked details flag', () => expect(() => validateBookingPlayerUpdate({ ...positionOnly(), level: 'intermediate' })).toThrow('Clear player details'))
  it('requires the current entry version', () => expect(() => validateBookingPlayerUpdate({ ...positionOnly(), expected_version: undefined })).toThrow('player version'))
  it('requires explicit boolean opt-in', () => expect(() => validateBookingPlayerUpdate({ ...positionOnly(), has_details: 'false' })).toThrow('whether to add'))
  it('requires valid existing target IDs', () => expect(() => validateBookingPlayerUpdate({ ...positionOnly(), entry_id: 'any' })).toThrow('ID'))
})
describe('owner player-detail route security boundary', () => {
  it('uses only established guest ownership and returns an uncached owned entry', async () => {
    const response = await POST(request(positionOnly()))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(rpc).toHaveBeenCalledWith('dvc_booking_player_update', { p_org: '00000000-0000-0000-0000-000000000001', p_user: null, p_guest: 'a'.repeat(64), p_data: { ...positionOnly(), email: null }, p_ref: expect.any(String) })
    expect(guest).not.toHaveBeenCalledWith(true)
  })
  it('never mints a guest token to gain booking access', async () => {
    vi.mocked(guest).mockResolvedValue(null)
    const response = await POST(request(positionOnly()))
    expect(response.status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
    expect(guest).not.toHaveBeenCalledWith(true)
  })
  it('uses verified actor ownership with no guest fallback', async () => {
    vi.mocked(identity).mockResolvedValue({ user: { id, email: 'actor@example.test' }, role: 'player', developer: false })
    await POST(request(positionOnly()))
    expect(rpc).toHaveBeenCalledWith('dvc_booking_player_update', expect.objectContaining({ p_user: id, p_guest: null }))
    expect(guest).not.toHaveBeenCalled()
  })
  it('rejects a cross-origin edit before actor lookup', async () => {
    const response = await POST(request(positionOnly(), 'https://evil.example'))
    expect(response.status).toBe(403)
    expect(identity).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('maps indistinguishable missing/unowned booking denials to 404', async () => {
    vi.mocked(rpc).mockRejectedValue(new ClubError('Booking not found', 409, 'CONFLICT'))
    const response = await POST(request(positionOnly()))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'Booking not found', code: 'NOT_FOUND' })
  })
  it('preserves stale-version conflicts', async () => {
    vi.mocked(rpc).mockRejectedValue(new ClubError('Player details changed. Reload and try again', 409, 'CONFLICT'))
    expect((await POST(request(positionOnly()))).status).toBe(409)
  })
  it('retains server cutoff denials rather than claiming the edit succeeded', async () => {
    vi.mocked(rpc).mockRejectedValue(new ClubError('Player details can only be edited until one hour before the game', 409, 'CONFLICT'))
    const response = await POST(request(positionOnly()))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'CONFLICT' })
    expect(logFailure).toHaveBeenCalledWith(expect.any(String), 'booking.player.update', 'CONFLICT', null)
  })
  it('does not accept caller-supplied actor/guest overrides', async () => {
    const response = await POST(request({ ...positionOnly(), user_id: id, guest_hash: 'b'.repeat(64) }))
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
})
