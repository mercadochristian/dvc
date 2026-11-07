import { describe, expect, it } from 'vitest'
import { assetPath, dateWindow, normalizeEmail, validateAction, validateHold } from '@/features/club/model/validation'
import { assertSameOrigin, imageType, limitedBody } from '@/features/club/server/http'
import { canAct } from '@/features/club/model/permissions'
const id = '11111111-1111-4111-8111-111111111111'
const hold = { level:'intermediate', birth_date:'2000-02-29',first_timer:true, gender:'prefer_not_to_say', game_id: id, kind: 'individual', position: 'setter', name: ' Ana ', contact: 'ana@example.com' }
describe('registration validation', () => {
  it('normalizes player names', () => expect(validateHold(hold).name).toBe('Ana'))
  it('accepts a six-player team', () => expect(validateHold({ ...hold, kind: 'team' }).kind).toBe('team'))
  it('keeps the team registrant’s selected position', () => expect(validateHold({ ...hold, kind: 'team' }).position).toBe('setter'))
  it('does not accept removed group registration', () => expect(() => validateHold({ ...hold, kind: 'group' })).toThrow('Choose individual or team'))
  it.each(['', 'setter OR true', null, [], {}])('rejects invalid position %s', position => expect(() => validateHold({ ...hold, position })).toThrow())
  it.each(['game-1', '', null])('rejects invalid game ID %s', game_id => expect(() => validateHold({ ...hold, game_id })).toThrow())
  it('does not allow an empty name', () => expect(() => validateHold({ ...hold, name: ' ' })).toThrow('Check name'))
  it('does not allow oversized contact', () => expect(() => validateHold({ ...hold, contact: 'a'.repeat(161) })).toThrow())
  it('does not forward a client-supplied price', () => expect(validateHold({ ...hold, amount: 1 })).not.toHaveProperty('amount'))
  it('does not forward a client-supplied user', () => expect(validateHold({ ...hold, user_id: id })).not.toHaveProperty('user_id'))
})
describe('staff action validation', () => {
  it('normalizes whitelist addresses', () => expect(normalizeEmail(' ANA@Example.com ')).toBe('ana@example.com'))
  it.each(['a', 'a@b', 'a b@c.com'])('rejects invalid email %s', email => expect(() => normalizeEmail(email)).toThrow())
  it('allows facilitator assignment fields', () => expect(validateAction('roster.update', { expected_version: 0, id, name: ' Ana ', team: 2 })).toEqual({ expected_version: 0, id, name: 'Ana', team: 2 }))
  it('allows clearing a lineup', () => expect(validateAction('roster.update', { expected_version: 0, id, name: '', team: null }).team).toBeNull())
  it.each([0, -1, 21, 1.5])('rejects invalid team %s', team => expect(() => validateAction('roster.update', { expected_version: 0, id, name: 'Ana', team })).toThrow())
  it('requires receipt rejection reason', () => expect(() => validateAction('receipt.reject', { id, note: ' ' })).toThrow())
  it('validates a developer role while leaving authorization to the server', () => expect(validateAction('access.save', { email: 'ana@example.com', role: 'developer', enabled: true }).role).toBe('developer'))
  it('does not coerce enabled strings', () => expect(() => validateAction('access.save', { email: 'ana@example.com', role: 'admin', enabled: 'true' })).toThrow())
  it('does not accept unknown actions', () => expect(() => validateAction('system.reset', {})).toThrow())
  const game = { venue_id: id, team_count: 4, venue: 'Court', city: 'Makati', starts_at: '2026-11-07T18:00:00+08:00', ends_at: '2026-11-07T21:00:00+08:00', status: 'published', team_price: 165000, positions: Object.fromEntries(['open','opposite','middle','setter'].map(p => [p, { capacity: 4, price: 30000 }])) }
  it('converts Manila times to UTC', () => expect(validateAction('game.save', game).starts_at).toBe('2026-11-07T10:00:00.000Z'))
  it('requires end after start', () => expect(() => validateAction('game.save', { ...game, ends_at: game.starts_at })).toThrow())
  it('requires all positions', () => expect(() => validateAction('game.save', { ...game, positions: {} })).toThrow())
  it('rejects decimal centavo prices', () => expect(() => validateAction('game.save', { ...game, team_price: 1.5 })).toThrow())
})
describe('role boundaries', () => {
  const adminActions = ['game.save','game.cancel','manual.register','payment.save','access.save','receipt.approve','receipt.reject','booking.cancel','booking.transfer']
  it.each(adminActions)('player cannot %s', action => expect(canAct('player', action)).toBe(false))
  it.each(adminActions)('facilitator cannot %s', action => expect(canAct('facilitator', action)).toBe(false))
  it.each(adminActions)('admin can %s', action => expect(canAct('admin', action)).toBe(true))
  it('denies lineup editing to the on-court facilitator', () => expect(canAct('facilitator','roster.update')).toBe(false))
})
describe('request and file boundaries', () => {
  it('rejects QR paths that traverse into receipts',()=>expect(()=>assetPath(`payments/${id}/../../receipts/${id}/${id}.png`,'payments',id)).toThrow())
  it('rejects QR query strings',()=>expect(()=>assetPath(`payments/${id}/${id}.png?token=abc`,'payments',id)).toThrow())
  it('rejects another organization’s QR',()=>expect(()=>assetPath(`payments/${id}/${id}.png`,'payments','22222222-2222-4222-8222-222222222222')).toThrow())
  it('accepts canonical QR paths',()=>expect(assetPath(`payments/${id}/${id}.png`,'payments',id)).toBe(`payments/${id}/${id}.png`))
  it('caps actual body size without Content-Length',async()=>{await expect(limitedBody(new Request('https://dvc.example/api',{method:'POST',body:'123456'}),5)).rejects.toMatchObject({status:413})})
  it('accepts same-origin writes', () => expect(() => assertSameOrigin(new Request('https://dvc.example/api', { headers: { origin: 'https://dvc.example' } }))).not.toThrow())
  it('uses actual Host when Next uses a different internal origin',()=>expect(()=>assertSameOrigin(new Request('http://localhost:3000/api',{headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000'}}))).not.toThrow())
  it.each([null, 'https://evil.example'])('rejects absent or foreign origin %s', origin => expect(() => assertSameOrigin(new Request('https://dvc.example/api', { headers: origin ? { origin } : {} }))).toThrow())
  it('uses Manila midnight for schedule ranges', () => expect(dateWindow('2026-11-02','2026-11-09').start).toBe('2026-11-01T16:00:00.000Z'))
  it.each([['2026-11-09','2026-11-02'],['2026-11-02','2027-11-02'],[null,'2026-11-02']])('rejects invalid date range %s %s', (start,end) => expect(() => dateWindow(start,end)).toThrow())
  it('accepts PNG signature', () => expect(imageType(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]))).toBe('image/png'))
  it('accepts JPEG signature', () => expect(imageType(new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0]))).toBe('image/jpeg'))
  it('accepts WebP signature', () => expect(imageType(new TextEncoder().encode('RIFFxxxxWEBP'))).toBe('image/webp'))
  it('rejects SVG markup regardless of file extension', () => expect(() => imageType(new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).toThrow())
  it('rejects oversized images', () => expect(() => imageType(new Uint8Array(3145729))).toThrow())
})
