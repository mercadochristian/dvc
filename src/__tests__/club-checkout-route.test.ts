import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/features/club/server/gateway', () => ({ configured: vi.fn(), db: vi.fn(), guard: vi.fn(), guest: vi.fn(), identity: vi.fn(), logFailure: vi.fn(), ORG: '00000000-0000-0000-0000-000000000001', rpc: vi.fn() }))
import { guest, identity, logFailure, rpc } from '@/features/club/server/gateway'
import { GET, POST } from '@/app/api/club/route'
const id = '11111111-1111-4111-8111-111111111111'
const draft = () => ({ request_id: id, organizer: { name: 'Organizer', contact: '09123456789', email: 'ORGANIZER@example.test' }, games: [{ game_id: id, kind: 'group', organizer_plays: false, players: [1,2].map(index => ({ name: `Player ${index}`, position: 'setter', is_registrant: false, has_details: true, level: 'intermediate', gender: 'female', birth_date: '1995-04-12', first_timer: false })) }] })
const request = (data: unknown, origin = 'http://localhost', action = 'checkout.review') => new Request('http://localhost/api/club', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) })
beforeEach(() => { vi.resetAllMocks(); vi.mocked(identity).mockResolvedValue({ user: null, role: 'player', developer: false }); vi.mocked(rpc).mockResolvedValue({ games: [], amount: 50000 }); vi.mocked(guest).mockResolvedValue('a'.repeat(64)) })
describe('checkout review API', () => {
  it('uses only the authoritative read-only quote RPC', async () => { await POST(request(draft())); expect(rpc).toHaveBeenCalledTimes(1) })
  it('passes normalized player selections to the quote RPC', async () => { await POST(request(draft())); expect(rpc).toHaveBeenCalledWith('dvc_checkout_review', { p_org: '00000000-0000-0000-0000-000000000001', p_data: expect.objectContaining({ organizer: expect.objectContaining({ email: 'organizer@example.test' }) }) }) })
  it('never replaces the established guest owner during review', async () => { await POST(request(draft())); expect(guest).not.toHaveBeenCalledWith(true) })
  it('returns server totals without public caching', async () => { const response = await POST(request(draft())); expect(response.headers.get('cache-control')).toBe('private, no-store') })
  it('returns the computed quote to the caller', async () => { const response = await POST(request(draft())); expect(await response.json()).toMatchObject({ checkout: { amount: 50000 }, reference: expect.any(String) }) })
  it('validates a bad draft before contacting the quote function', async () => { await POST(request({ ...draft(), games: [] })); expect(rpc).not.toHaveBeenCalled() })
  it('rejects a cross-origin request before actor lookup', async () => { await POST(request(draft(), 'https://evil.example')); expect(identity).not.toHaveBeenCalled() })
  it('reports quote conflicts while retaining a safe reference', async () => { const { ClubError } = await import('@/features/club/model/validation'); vi.mocked(rpc).mockRejectedValue(new ClubError('That position is no longer available', 409, 'CONFLICT')); const response = await POST(request(draft())); expect(response.status).toBe(409) })
  it('logs only the known checkout action and error code', async () => { await POST(request({})); expect(logFailure).toHaveBeenCalledWith(expect.any(String), 'checkout.review', 'INVALID_REQUEST', null) })
  it('does not establish a guest owner when review fails', async () => { vi.mocked(rpc).mockRejectedValue(new Error('Quote unavailable')); await POST(request(draft())); expect(guest).not.toHaveBeenCalledWith(true) })
  it('does not create guest ownership for an authenticated review', async () => { vi.mocked(identity).mockResolvedValue({user:{id,email:'actor@example.test'},role:'player',developer:false}); await POST(request(draft())); expect(guest).not.toHaveBeenCalled() })
  it('requires settled guest bootstrap before review can contact the database', async () => { vi.mocked(guest).mockResolvedValue(null); const response=await POST(request(draft())); expect(await response.json()).toMatchObject({code:'CHECKOUT_SESSION_REQUIRED'}) })
  it('does not calculate a quote without stable guest ownership', async () => { vi.mocked(guest).mockResolvedValue(null); await POST(request(draft())); expect(rpc).not.toHaveBeenCalled() })
})
describe('new player details versus existing hold retry transport', () => {
  const legacy = () => { const value = consented(); return { ...value, games: value.games.map(game => ({ ...game, players: [1,2].map(() => ({ name: null, position: 'setter', is_registrant: false })) })) } }
  it('rejects unnamed players at the new review boundary before RPC', async () => {
    const response = await POST(request(legacy()))
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('preserves an accepted legacy request fingerprint shape for the owned hold RPC replay', async () => {
    vi.mocked(rpc).mockResolvedValue({ outcome: 'existing', checkout: checkout() })
    const response = await POST(request(legacy(), 'http://localhost', 'checkout.hold'))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('dvc_checkout_hold', expect.objectContaining({ p_data: expect.objectContaining({ games: [expect.objectContaining({ players: [1,2].map(() => ({ position: 'setter', name: null, is_registrant: false, email: null })) })] }) }))
  })
  it('does not turn the RPC strict-new-request rejection into a successful legacy creation', async () => {
    vi.mocked(rpc).mockResolvedValue({ outcome: 'selection_conflict', conflicts: [{ game_id: id, code: 'SELECTION_UNAVAILABLE' }] })
    const response = await POST(request(legacy(), 'http://localhost', 'checkout.hold'))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'CHECKOUT_SELECTION_CONFLICT' })
  })
})
describe('guest bootstrap metadata endpoint', () => {
  it('establishes guest ownership only at the explicit bootstrap action', async () => { await POST(request({},'http://localhost','guest.bootstrap')); expect(guest).toHaveBeenCalledWith(true) })
  it('returns acknowledgment without exposing the guest credential', async () => { const response=await POST(request({},'http://localhost','guest.bootstrap')); expect(await response.json()).toEqual({ready:true,reference:expect.any(String)}) })
  it('does not create guest ownership for an authenticated actor', async () => { vi.mocked(identity).mockResolvedValue({user:{id,email:'actor@example.test'},role:'player',developer:false}); await POST(request({},'http://localhost','guest.bootstrap')); expect(guest).not.toHaveBeenCalled() })
  it('blocks cross-origin bootstrap before writing a cookie', async () => { await POST(request({},'https://evil.example','guest.bootstrap')); expect(guest).not.toHaveBeenCalled() })
  it('does not treat bootstrap as a domain reservation write', async () => { await POST(request({},'http://localhost','guest.bootstrap')); expect(rpc).not.toHaveBeenCalled() })
})

function consented() { const value = draft(); return { ...value, games:value.games.map(game=>({...game,expected_amount:50000,expected_quote:{venue:'Court',city:'Manila',maps_url:null,starts_at:'2027-01-05T10:00:00Z',ends_at:'2027-01-05T12:00:00Z',team_price:150000,position_prices:{setter:25000}}}))} }
const hold = () => request(consented(),'http://localhost','checkout.hold')
const checkout = () => ({id,status:'holding',payment_status:'pending',amount:50000,expires_at:'2027-01-01T00:10:00Z',created_at:'2027-01-01T00:00:00Z',bookings:[]})
describe('atomic checkout hold API classification', () => {
  it('retires public legacy creation without contacting the old hold RPC', async () => { const response=await POST(request({},'http://localhost','booking.hold')); expect(await response.json()).toMatchObject({code:'LEGACY_REGISTRATION_RETIRED'}) })
  it('never creates legacy booking holds from the retired route', async () => { await POST(request({},'http://localhost','booking.hold')); expect(rpc).not.toHaveBeenCalled() })
  it('rejects missing stable guest ownership before hold creation', async () => { vi.mocked(guest).mockResolvedValue(null); const response=await POST(hold()); expect(await response.json()).toMatchObject({code:'CHECKOUT_REVIEW_REQUIRED'}) })
  it('does not send two cookie-less concurrent confirmations to the database', async () => { vi.mocked(guest).mockResolvedValue(null); await Promise.all([POST(hold()),POST(hold())]); expect(rpc).not.toHaveBeenCalled() })
  it('never mints or replaces guest ownership during hold confirmation', async () => { vi.mocked(guest).mockResolvedValue(null); await POST(hold()); expect(guest).not.toHaveBeenCalledWith(true) })
  it('uses only the established guest credential for atomic hold', async () => { vi.mocked(rpc).mockResolvedValue({outcome:'created',checkout:checkout()}); await POST(hold()); expect(rpc).toHaveBeenCalledWith('dvc_checkout_hold',expect.objectContaining({p_user:null,p_guest:'a'.repeat(64)})) })
  it('takes account ownership from verified identity rather than supplied data', async () => { vi.mocked(identity).mockResolvedValue({user:{id,email:'actor@example.test'},role:'player',developer:false}); vi.mocked(rpc).mockResolvedValue({outcome:'created',checkout:checkout()}); await POST(request({...consented(),user_id:'spoofed',guest_hash:'spoofed'},'http://localhost','checkout.hold')); expect(rpc).toHaveBeenCalledWith('dvc_checkout_hold',expect.objectContaining({p_user:id,p_guest:null})) })
  it('does not inspect guest ownership for an authenticated hold', async () => { vi.mocked(identity).mockResolvedValue({user:{id,email:'actor@example.test'},role:'player',developer:false}); vi.mocked(rpc).mockResolvedValue({outcome:'created',checkout:checkout()}); await POST(hold()); expect(guest).not.toHaveBeenCalled() })
  it('returns the original checkout for a same-intent retry', async () => { vi.mocked(rpc).mockResolvedValue({outcome:'existing',checkout:checkout()}); const response=await POST(hold()); expect(await response.json()).toMatchObject({checkout:checkout()}) })
  it('labels only proven no-write selection conflicts as safe to edit', async () => { vi.mocked(rpc).mockResolvedValue({outcome:'selection_conflict',conflicts:[{game_id:id,code:'PRICE_CHANGED'}]}); const response=await POST(hold()); expect(await response.json()).toMatchObject({code:'CHECKOUT_SELECTION_CONFLICT',conflicts:[{game_id:id,code:'PRICE_CHANGED'}]}) })
  it('returns the owned original checkout when a request key was reused for another payload', async () => { vi.mocked(rpc).mockResolvedValue({outcome:'intent_mismatch',checkout:checkout()}); const response=await POST(hold()); expect(await response.json()).toMatchObject({code:'CHECKOUT_INTENT_MISMATCH',checkout:checkout()}) })
  it('does not classify generic database conflicts as proven no-hold outcomes', async () => { const {ClubError}=await import('@/features/club/model/validation'); vi.mocked(rpc).mockRejectedValue(new ClubError('Database conflict',409,'CONFLICT')); const response=await POST(hold()); expect(await response.json()).toMatchObject({code:'CONFLICT'}) })
  it('keeps unknown transport failures distinct from selection conflicts', async () => { vi.mocked(rpc).mockRejectedValue(new Error('Network lost')); const response=await POST(hold()); expect(response.status).toBe(500) })
  it('rejects malformed RPC success instead of claiming a confirmed checkout', async () => { vi.mocked(rpc).mockResolvedValue({outcome:'unknown'}); const response=await POST(hold()); expect(await response.json()).toMatchObject({code:'CHECKOUT_UNAVAILABLE'}) })
  it('rejects hold requests missing price consent before any mutation RPC', async () => { await POST(request(draft(),'http://localhost','checkout.hold')); expect(rpc).not.toHaveBeenCalled() })
})
describe('owned checkout read API', () => {
  it('passes only the authenticated actor to checkout read', async () => { vi.mocked(identity).mockResolvedValue({user:{id,email:'actor@example.test'},role:'player',developer:false}); vi.mocked(rpc).mockImplementation(async name=>name==='dvc_checkout_read'?checkout():[]); await GET(new Request(`http://localhost/api/club?view=checkout&id=${id}&user_id=spoofed`)); expect(rpc).toHaveBeenCalledWith('dvc_checkout_read',expect.objectContaining({p_user:id,p_guest:null,p_checkout:id})) })
  it('does not expose a checkout to an unrelated owner', async () => { vi.mocked(rpc).mockResolvedValue(null); const response=await GET(new Request(`http://localhost/api/club?view=checkout&id=${id}`)); expect(response.status).toBe(404) })
})
