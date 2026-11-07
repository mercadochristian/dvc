import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/features/club/server/gateway', () => ({ configured: vi.fn(), db: vi.fn(), guard: vi.fn(), guest: vi.fn(), identity: vi.fn(), logFailure: vi.fn(), ORG: '00000000-0000-0000-0000-000000000001', rpc: vi.fn() }))
import { configured, db, guest, identity, logFailure, rpc } from '@/features/club/server/gateway'
import { GET, POST } from '@/app/api/club/route'
const id='11111111-1111-4111-8111-111111111111'
function holdData(team=false) {
 const positions=team?['open','open','opposite','middle','middle','setter']:['setter']
 const players=positions.map(position=>team?{position,name:null,is_registrant:false}:{position,name:'Ana',is_registrant:true,level:'intermediate',birth_date:'2000-02-29',first_timer:true,gender:'prefer_not_to_say'})
 return {request_id:id,organizer:{name:'Ana',contact:'ana@example.test',email:'ana@example.test'},games:[{game_id:id,kind:team?'team':'individual',organizer_plays:!team,players,expected_amount:25000,expected_quote:{venue:'Court',city:'Manila',maps_url:null,starts_at:'2027-01-05T10:00:00Z',ends_at:'2027-01-05T12:00:00Z',team_price:150000,position_prices:Object.fromEntries(positions.map(position=>[position,25000]))}}]}
}
function post(action:string,data:unknown,origin='http://localhost'){return new Request('http://localhost/api/club',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify({action,data})})}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(configured).mockReturnValue(true);vi.mocked(identity).mockResolvedValue({user:null,role:'player',developer:false});vi.mocked(guest).mockResolvedValue('a'.repeat(64));vi.mocked(rpc).mockImplementation(async name => name === 'dvc_checkout_hold' ? { outcome: 'created', checkout: { id } } : [])})
describe('club API access',()=>{
  it('reports setup status without attempting authentication',async()=>{vi.mocked(configured).mockReturnValue(false);const r=await GET(new Request('http://localhost/api/club?view=session'));expect(await r.json()).toMatchObject({configured:false})})
  it('reads public schedules without session lookup',async()=>{await GET(new Request('http://localhost/api/club?view=schedule&from=2026-11-02&to=2026-11-09'));expect(identity).not.toHaveBeenCalled()})
  it('rejects another origin before reading identity',async()=>{await POST(post('booking.hold',{},'http://evil.example'));expect(identity).not.toHaveBeenCalled()})
  it('denies staff workspace to players',async()=>{const r=await GET(new Request('http://localhost/api/club?view=workspace'));expect(r.status).toBe(403)})
  it('denies developer log to ordinary admins',async()=>{vi.mocked(identity).mockResolvedValue({user:null,role:'admin',developer:false});const r=await GET(new Request('http://localhost/api/club?view=logs'));expect(r.status).toBe(403)})
  it('allows developer log only with verified server capability',async()=>{vi.mocked(identity).mockResolvedValue({user:null,role:'developer',developer:true});vi.mocked(db).mockResolvedValue([]);const r=await GET(new Request('http://localhost/api/club?view=logs'));expect(r.status).toBe(200)})
  it('rejects query injection in log reference',async()=>{vi.mocked(identity).mockResolvedValue({user:null,role:'developer',developer:true});const r=await GET(new Request('http://localhost/api/club?view=logs&reference=or=(true)'));expect(r.status).toBe(400)})
  it('preserves PostgreSQL microseconds in log pagination',async()=>{vi.mocked(identity).mockResolvedValue({user:null,role:'developer',developer:true});vi.mocked(db).mockResolvedValue([]);await GET(new Request(`http://localhost/api/club?view=logs&before=${encodeURIComponent(`2026-11-03T01:00:00.123456+00:00|${id}`)}`));expect(decodeURIComponent(vi.mocked(db).mock.calls[0][0])).toContain('created_at.eq.2026-11-03T01:00:00.123456+00:00')})
  it.each([0, 100, 101])('reports log continuation for %i returned database rows', async count => {
    vi.mocked(identity).mockResolvedValue({ user: null, role: 'developer', developer: true })
    const created_at = '2026-11-03T01:00:00.123456+00:00'
    const rows = Array.from({ length: count }, (_, index) => ({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, created_at,
    }))
    vi.mocked(db).mockResolvedValue(rows)
    const response = await GET(new Request('http://localhost/api/club?view=logs&pagination=cursor'))
    expect(await response.json()).toEqual({
      events: rows.slice(0, 100), next_cursor: count > 100 ? `${created_at}|${rows[99].id}` : null,
    })
    expect(vi.mocked(db).mock.calls[0][0]).toContain('&limit=101')
  })
  it('retains the array response for legacy log requests', async () => {
    vi.mocked(identity).mockResolvedValue({ user: null, role: 'developer', developer: true })
    vi.mocked(db).mockResolvedValue([{ id }])
    const response = await GET(new Request('http://localhost/api/club?view=logs'))
    expect(await response.json()).toEqual([{ id }])
    expect(vi.mocked(db).mock.calls[0][0]).toContain('&limit=100')
  })
  it('blocks facilitator payment management',async()=>{vi.mocked(identity).mockResolvedValue({user:null,role:'facilitator',developer:false});const r=await POST(post('receipt.approve',{id}));expect(r.status).toBe(403)})
  it('allows coordinator lineup updates',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'staff@example.com'},role:'coordinator',developer:false});const r=await POST(post('roster.update',{expected_version:0,id,name:'Ana',team:1}));expect(r.status).toBe(200)})
  it('lets staff book through the same checkout player rules',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'admin@example.com'},role:'admin',developer:false});const response=await POST(post('checkout.hold',holdData()));expect(response.status).toBe(200)})
  it('never adds guest ownership to account checkouts',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'ana@example.com'},role:'player',developer:false});await POST(post('checkout.hold',holdData()));expect(rpc).toHaveBeenCalledWith('dvc_checkout_hold',expect.objectContaining({p_user:id,p_guest:null}))})
  it('uses the existing private browser credential only for guest checkouts',async()=>{await POST(post('checkout.hold',holdData()));expect(rpc).toHaveBeenCalledWith('dvc_checkout_hold',expect.objectContaining({p_user:null,p_guest:'a'.repeat(64)}))})
  it('attaches a reference ID to errors',async()=>{const r=await POST(post('receipt.approve',{id}));expect(await r.json()).toHaveProperty('reference',expect.stringMatching(/^[a-f0-9-]{36}$/))})
  it('records failed actions separately',async()=>{await POST(post('receipt.approve',{id}));expect(logFailure).toHaveBeenCalledWith(expect.any(String),'receipt.approve','ACCESS_DENIED',null)})
  it('does not log an untrusted raw action string',async()=>{await POST(post('a-secret-password',{}));expect(logFailure).toHaveBeenCalledWith(expect.any(String),'unknown',expect.any(String),null)})
  it('does not cache private data',async()=>{const r=await GET(new Request('http://localhost/api/club?view=mine'));expect(r.headers.get('cache-control')).toBe('private, no-store')})
})

describe('operations API role enforcement',()=>{
  it('denies lineup edits to on-court facilitators',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'staff@example.com'},role:'facilitator',developer:false});const r=await POST(post('roster.update',{id,name:'Ana',team:1,expected_version:0}));expect(r.status).toBe(403)})
  it('allows coordinators to add a manual registration',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'staff@example.com'},role:'coordinator',developer:false});const r=await POST(post('manual.register',{level:'intermediate',birth_date:'2000-02-29',first_timer:true,gender:'prefer_not_to_say',game_id:id,kind:'individual',position:'setter',name:'Ana',contact:'ana@example.test'}));expect(r.status).toBe(200)})
  const manualGroup = {
    request_id: id, organizer: { name: 'Ana', contact: 'ana@example.test' },
    games: [{ game_id: id, kind: 'group', organizer_plays: false, expected_amount: 50000,
      expected_quote: { ...holdData().games[0].expected_quote, position_prices: { open: 25000 } },
      players: Array.from({ length: 2 }, () => ({ position: 'open', is_registrant: false, has_details: false })) }],
  }
  it('routes a scoped manual group to the standalone reservation RPC with its retry ID', async () => {
    vi.mocked(identity).mockResolvedValue({ user: { id, email: 'staff@example.com' }, role: 'coordinator', developer: false })
    vi.mocked(rpc).mockResolvedValue(id)
    const response = await POST(post('manual.register', manualGroup))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('dvc_manual_register', expect.objectContaining({
      p_user: id, p_data: expect.objectContaining({ request_id: id, games: [expect.objectContaining({ kind: 'group', organizer_plays: false, expected_amount: 50000, expected_quote: manualGroup.games[0].expected_quote })] }),
    }))
    expect(await response.json()).toMatchObject({ id })
  })
  it('denies facilitators the standalone reservation RPC', async () => {
    vi.mocked(identity).mockResolvedValue({ user: { id, email: 'staff@example.com' }, role: 'facilitator', developer: false })
    const response = await POST(post('manual.register', manualGroup))
    expect(response.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('denies venue management to coordinators',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'staff@example.com'},role:'coordinator',developer:false});const r=await POST(post('venue.save',{name:'Court',city:'Makati',enabled:true}));expect(r.status).toBe(403)})
  it('denies an Administrator granting Developer',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'staff@example.com'},role:'admin',developer:false});const r=await POST(post('access.save',{email:'player@example.test',role:'developer',enabled:true}));expect(r.status).toBe(403)})
  it('allows a Developer to grant Developer',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'staff@example.com'},role:'developer',developer:true});const r=await POST(post('access.save',{email:'player@example.test',role:'developer',enabled:true,expected_version:null}));expect(r.status).toBe(200)})
  it('rejects another user in a self-volunteer request',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'staff@example.com'},role:'facilitator',developer:false});const r=await POST(post('faci.self',{game_id:id,user_id:id,enabled:true}));expect(r.status).toBe(400)})
})

describe('milestone profile and announcement API boundaries',()=>{
  it('does not look up registration history for a guest email',async()=>{const r=await GET(new Request('http://localhost/api/club?view=profile&email=someone@example.test'));expect(await r.json()).toBeNull();expect(rpc).not.toHaveBeenCalled()})
  it('loads only the authenticated actor profile despite a supplied user ID',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'owner@example.test'},role:'player',developer:false});await GET(new Request('http://localhost/api/club?view=profile&user_id=22222222-2222-4222-8222-222222222222'));expect(rpc).toHaveBeenCalledWith('dvc_profile',{p_org:'00000000-0000-0000-0000-000000000001',p_user:id})})
  it('loads public announcements without identity or private workspace access',async()=>{await GET(new Request('http://localhost/api/club?view=announcements'));expect(identity).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledWith('dvc_announcements',{p_org:'00000000-0000-0000-0000-000000000001'})})
  it('allows a coordinator to publish an announcement',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'staff@example.test'},role:'coordinator',developer:false});const r=await POST(post('announcement.save',{title:'Update',body:'Check the schedule.',enabled:true,publish_at:'2027-01-05T10:00:00Z',ends_at:'2027-01-05T12:00:00Z'}));expect(r.status).toBe(200)})
  it('denies announcement publication to a facilitator',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'staff@example.test'},role:'facilitator',developer:false});const r=await POST(post('announcement.save',{title:'Update',body:'Check the schedule.',enabled:true,publish_at:'2027-01-05T10:00:00Z',ends_at:'2027-01-05T12:00:00Z'}));expect(r.status).toBe(403)})
  it('keeps logged-in team organizers as checkout owners without a player slot',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'owner@example.test'},role:'player',developer:false});await POST(post('checkout.hold',holdData(true)));expect(rpc).toHaveBeenCalledWith('dvc_checkout_hold',expect.objectContaining({p_user:id,p_guest:null,p_data:expect.objectContaining({games:[expect.objectContaining({organizer_plays:false,players:expect.arrayContaining([expect.objectContaining({name:null,is_registrant:false})])})]})}))})
})

describe('M6 management boundaries', () => {
  it.each(['management-users', 'management-payments', 'management-methods', 'management-venues'])(
    'denies %s to Coordinators before reading private data', async view => {
      vi.mocked(identity).mockResolvedValue({ user: { id }, role: 'coordinator', developer: false })
      const response = await GET(new Request(`http://localhost/api/club?view=${view}`))
      expect(response.status).toBe(403)
      expect(rpc).not.toHaveBeenCalled()
      expect(db).not.toHaveBeenCalled()
    },
  )
  it('rejects oversized Users pages and preserves the Games workspace without the directory', async () => {
    vi.mocked(identity).mockResolvedValue({ user: { id }, role: 'admin', developer: false })
    const oversized = await GET(new Request('http://localhost/api/club?view=management-users&limit=51'))
    expect(oversized.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
    vi.mocked(rpc).mockResolvedValue({ role: 'admin', games: [], roster: [], users: [{ id }], access: [{ id }] })
    const workspace = await GET(new Request('http://localhost/api/club?view=workspace'))
    expect(await workspace.json()).toEqual({ role: 'admin', games: [], roster: [] })
  })
  it('rejects an access write that omits its original version', async () => {
    vi.mocked(identity).mockResolvedValue({ user: { id }, role: 'admin', developer: false })
    const response = await POST(post('access.save', { email: 'user@example.invalid', role: 'coordinator', enabled: true }))
    expect(response.status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('checks a role edit against its original version', async () => {
    vi.mocked(identity).mockResolvedValue({ user: { id }, role: 'admin', developer: false })
    vi.mocked(rpc).mockResolvedValue(id)
    const response = await POST(post('access.save', { id, email: 'USER@example.invalid', role: 'coordinator', enabled: true, expected_version: '1337' }))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('dvc_management_access_save', expect.objectContaining({
      p_user: id, p_data: { id, email: 'user@example.invalid', role: 'coordinator', enabled: true, expected_version: '1337' },
    }))
  })
})

describe('M6 game creation request', () => {
  const game = {
    venue_id: id, team_count: 4, starts_at: '2099-11-07T18:00:00+08:00',
    ends_at: '2099-11-07T21:00:00+08:00', status: 'published', team_price: 165000,
    positions: Object.fromEntries(['open', 'opposite', 'middle', 'setter'].map(position => [position, { capacity: 4, price: 30000 }])),
  }

  it('requires a create intent but keeps ordinary game edits on the existing action', async () => {
    vi.mocked(identity).mockResolvedValue({ user: { id }, role: 'admin', developer: false })
    expect((await POST(post('game.save', game))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
    expect((await POST(post('game.save', { ...game, request_id: id }))).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('dvc_create_game_once', expect.objectContaining({
      p_user: id, p_request: id, p_data: expect.objectContaining({ starts_at: '2099-11-07T10:00:00.000Z' }),
    }))
    expect((await POST(post('game.save', { ...game, id }))).status).toBe(200)
    expect(rpc).toHaveBeenLastCalledWith('dvc_admin', expect.objectContaining({
      p_action: 'game.save', p_data: expect.objectContaining({ id }),
    }))
  })
})

describe('Game Management and saved skill routes', () => {
  it('denies Players both staff game reads before querying protected data', async () => {
    for (const query of ['view=staff-games', `view=staff-game-context&id=${id}&operation=roster`]) {
      const response = await GET(new Request(`http://localhost/api/club?${query}`))
      expect(response.status).toBe(403)
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('uses inclusive Manila dates and a scoped staff list query', async () => {
    vi.mocked(identity).mockResolvedValue({ user: { id }, role: 'facilitator', developer: false })
    const response = await GET(new Request('http://localhost/api/club?view=staff-games&from=2026-11-07&to=2026-11-07&sort=desc'))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('dvc_staff_games', expect.objectContaining({
      p_user: id, p_from: '2026-11-06T16:00:00.000Z', p_to: '2026-11-07T16:00:00.000Z', p_desc: true,
    }))
  })

  it('passes only the selected operation and game to the context RPC', async () => {
    vi.mocked(identity).mockResolvedValue({ user: { id }, role: 'coordinator', developer: false })
    vi.mocked(rpc).mockResolvedValue({ role: 'coordinator', games: [], roster: [] })
    const response = await GET(new Request(`http://localhost/api/club?view=staff-game-context&id=${id}&operation=roster`))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('dvc_staff_game_context', expect.objectContaining({
      p_user: id, p_game: id, p_operation: 'roster',
    }))
  })

  it('routes skill changes only for administrators', async () => {
    const payload = { user_id: id, level: 'advanced', expected_version: '23' }
    vi.mocked(identity).mockResolvedValue({ user: { id }, role: 'coordinator', developer: false })
    expect((await POST(post('profile.skill.save', payload))).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
    vi.mocked(identity).mockResolvedValue({ user: { id }, role: 'admin', developer: false })
    expect((await POST(post('profile.skill.save', payload))).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('dvc_management_skill_save', expect.objectContaining({
      p_actor: id, p_target: id, p_level: 'advanced', p_version: '23',
    }))
  })
})
