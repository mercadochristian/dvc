import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/features/club/server/gateway', () => ({ configured: vi.fn(), db: vi.fn(), guard: vi.fn(), guest: vi.fn(), identity: vi.fn(), logFailure: vi.fn(), ORG: '00000000-0000-0000-0000-000000000001', rpc: vi.fn() }))
import { identity, rpc } from '@/features/club/server/gateway'
import { GET } from '@/app/api/club/route'
import { parseBrowse, encodeBrowseCursor, selectedGameIds } from '@/features/club/model/browse-validation'
const id = '11111111-1111-4111-8111-111111111111'
const now = new Date('2026-11-04T00:00:00.000Z')
const parse = (query = '') => parseBrowse(new URLSearchParams(query), now)
beforeEach(() => { vi.resetAllMocks(); vi.mocked(rpc).mockResolvedValue({ games: [], next_key: null }) })
describe('bounded public browse inputs', () => {
  it('defaults to upcoming without date or venue limits', () => expect(parse()).toMatchObject({ filters: { date: null, venue: null, completed: false, cancelled: false, query: '', position: null }, anchor: now.toISOString(), cursor: null }))
  it.each(['date=2026-02-30','date=2026-13-01','completed=true','cancelled=2','position=libero','venue=oops','date=2026-11-04&date=2026-11-05','query='+ 'a'.repeat(121)])('rejects malformed filters %s', query => expect(() => parse(query)).toThrow())
  it('normalizes search before tying a cursor to it', () => expect(parse('query=San++CARLOS').scope).toBe(parse('query=san+carlos').scope))
  it('preserves the original anchor and exact key across pages', () => {
    const first = parse('completed=1'); const after = encodeBrowseCursor(first.scope, first.anchor, { bucket: 1, starts_at: '2026-11-03T10:00:00+00:00', id })
    expect(parse(`completed=1&after=${after}`)).toMatchObject({ anchor: first.anchor, cursor: { bucket: 1, id } })
    expect(() => parse(`after=${after}`)).toThrow('Invalid games cursor')
  })
  it.each([{ bucket: 2 }, { id: 'invalid' }, { starts_at: '2026-02-30T00:00:00Z' }, { anchor: '2027-01-01T00:00:00Z' }, { extra: 1 }])('rejects malformed cursor fields %j', change => {
    const first = parse(); const raw = { v: 1, scope: first.scope, anchor: first.anchor, bucket: 0, starts_at: first.anchor, id, ...change }
    expect(() => parse(`after=${Buffer.from(JSON.stringify(raw)).toString('base64url')}`)).toThrow('Invalid games cursor')
  })
  it('bounds each selected-ID request and deduplicates canonical IDs', () => {
    expect(selectedGameIds(new URLSearchParams(`ids=${id},${id}`))).toEqual([id])
    expect(() => selectedGameIds(new URLSearchParams(`ids=${Array(101).fill(id).join(',')}`))).toThrow('100')
    expect(() => selectedGameIds(new URLSearchParams('ids='))).toThrow()
  })
})
describe('public route contracts', () => {
  it('uses bounded RPC with server anchor without requiring an account', async () => {
    const response = await GET(new Request('http://localhost/api/club?view=games&completed=1&position=open'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ games: [], as_of: expect.any(String), next_cursor: null })
    expect(rpc).toHaveBeenCalledWith('dvc_games_browse', expect.objectContaining({ p_completed: true, p_cancelled: false, p_position: 'open', p_after_id: null }))
    expect(identity).not.toHaveBeenCalled()
  })
  it('returns minimal venue RPC unchanged and selected snapshots independently of filters', async () => {
    await GET(new Request('http://localhost/api/club?view=game-venues'))
    expect(rpc).toHaveBeenLastCalledWith('dvc_game_venues', expect.any(Object))
    await GET(new Request(`http://localhost/api/club?view=selected-games&ids=${id}&date=bad`))
    expect(rpc).toHaveBeenLastCalledWith('dvc_selected_games', { p_org: '00000000-0000-0000-0000-000000000001', p_ids: [id] })
    expect(identity).not.toHaveBeenCalled()
  })
  it.each(['after=bad', 'after='+id+'&after='+id])('rejects invalid venue pagination before RPC %s', async query => {
    const response = await GET(new Request('http://localhost/api/club?view=game-venues&'+query))
    expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects malformed input before database access' , async () => {
    const response = await GET(new Request('http://localhost/api/club?view=games&date=2026-02-30'))
    expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled()
  })
})
