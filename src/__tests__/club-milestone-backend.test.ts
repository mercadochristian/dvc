import { describe, expect, it } from 'vitest'
import { canAct } from '@/features/club/model/permissions'
import { teammateSlots, teammatesFrom } from '@/features/club/model/lineup'
import { playerProfileFrom } from '@/features/club/model/player-profile'
import { validateAction, validateHold, validatePlayerProfile } from '@/features/club/model/validation'
import { POSITIONS } from '@/features/club/model/types'
const id = '11111111-1111-4111-8111-111111111111'
const profile = { level: 'intermediate', gender: 'female', birth_date: '2000-02-29', first_timer: false }
const hold = { ...profile, game_id: id, kind: 'individual', position: 'setter', name: 'Ana', contact: 'ana@example.test' }
const game = { venue_id: id, team_count: 4, starts_at: '2099-11-07T18:00:00+08:00', ends_at: '2099-11-07T21:00:00+08:00', status: 'published', team_price: 165000, positions: Object.fromEntries(POSITIONS.map(p => [p, { capacity: 4, price: 30000 }])) }
describe('birthday-only and first-timer contracts', () => {
  it('requires birthday for new named players even with a legacy age', () => expect(() => validatePlayerProfile({ ...profile, birth_date: null, age: 25 })).toThrow('birthday'))
  it('preserves a valid legacy age when editing an existing profile', () => expect(validatePlayerProfile({ age: 25 }, false).age).toBe(25))
  it('does not require old records to invent first-timer history', () => expect(validatePlayerProfile({ age: 25 }, false).first_timer).toBeNull())
  it('requires an explicit first-timer choice on new registrations', () => expect(() => validateHold({ ...hold, first_timer: undefined })).toThrow('first-timer'))
  it.each(['false', 0, 1, {}])('rejects non-boolean first-timer %s', first_timer => expect(() => validateHold({ ...hold, first_timer })).toThrow('first-timer'))
  it('retains an explicit returnee choice', () => expect(validateHold(hold).first_timer).toBe(false))
  it('extracts first-timer true from a radio value', () => { const f = new FormData(); f.set('first_timer', 'true'); expect(playerProfileFrom(f).first_timer).toBe(true) })
  it('does not silently default an unselected radio to returnee', () => expect(playerProfileFrom(new FormData()).first_timer).toBeNull())
})
describe('non-playing team organizers', () => {
  const organizer = { game_id: id, kind: 'team', organizer_plays: false, name: 'Organizer', contact: 'organizer@example.test' }
  it('accepts organizer contact without a player profile', () => expect(validateHold(organizer)).toMatchObject({ organizer_plays: false, position: null }))
  it('does not manufacture balancing details for the organizer', () => expect(validateHold(organizer)).not.toHaveProperty('level'))
  it('provides all six fixed player positions', () => expect(teammateSlots(null).map(p => p.position)).toEqual(['open','open','opposite','middle','middle','setter']))
  it('accepts all six named actual players', () => expect(validateHold({ ...organizer, teammates: teammateSlots(null).map((s, i) => ({ ...profile, name: `Player ${i}`, position: s.position })) }).teammates).toHaveLength(6))
  it('continues to allow unnamed team placeholders', () => expect(validateHold({ ...organizer, teammates: [] }).teammates).toEqual([]))
  it('rejects a position assigned to a non-playing organizer', () => expect(() => validateHold({ ...organizer, position: 'setter' })).toThrow('no position'))
  it('rejects a non-playing individual booking', () => expect(() => validateHold({ ...organizer, kind: 'individual' })).toThrow('Only a team'))
  it('rejects invalid organizer participation values', () => expect(() => validateHold({ ...organizer, organizer_plays: 'false' })).toThrow())
  it('rejects a seventh teammate', () => expect(() => validateHold({ ...organizer, teammates: Array.from({ length: 7 }, () => ({ ...profile, position: 'open', name: 'Player' })) })).toThrow('6'))
  it('rejects two named setters despite six available total slots', () => expect(() => validateHold({ ...organizer, teammates: [1,2].map(i => ({ ...profile, position: 'setter', name: `Player ${i}` })) })).toThrow('Too many'))
  it('retains the five-name maximum when organizer is playing', () => expect(() => validateHold({ ...hold, kind: 'team', teammates: teammateSlots(null).map((s, i) => ({ ...profile, position: s.position, name: `Player ${i}` })) })).toThrow('5'))
})
describe('private notification recipient fields', () => {
  it('normalizes an organizer email separately from phone contact', () => expect(validateHold({ ...hold, contact: '+639000000000', organizer_email: ' ANA@EXAMPLE.TEST ' }).organizer_email).toBe('ana@example.test'))
  it('permits missing organizer email for legacy/manual contracts', () => expect(validateHold(hold).organizer_email).toBeNull())
  it('rejects malformed organizer email', () => expect(() => validateHold({ ...hold, organizer_email: 'invalid' })).toThrow('email'))
  it('rejects header injection in teammate email', () => expect(() => validateHold({ ...hold, kind: 'team', teammates: [{ ...profile, position: 'open', name: 'Player', email: 'a@example.test\r\nBcc:b@example.test' }] })).toThrow('email'))
  it('extracts optional teammate emails without adding blank placeholders', () => { const f = new FormData(); const slot = teammateSlots(null)[0]; f.set(slot.key, 'Player'); f.set(`${slot.key}-email`, 'player@example.test'); expect(teammatesFrom(f, null)[0].email).toBe('player@example.test') })
})
describe('fixed discounted prices', () => {
  it('accepts a discounted team total', () => expect(validateAction('game.save', { ...game, team_discount_price: 150000 }).team_discount_price).toBe(150000))
  it('accepts zero as a real discounted amount', () => expect(validateAction('game.save', { ...game, team_discount_price: 0 }).team_discount_price).toBe(0))
  it('rejects a team discount above the regular amount', () => expect(() => validateAction('game.save', { ...game, team_discount_price: 165001 })).toThrow('discounted price'))
  it.each([-1, 1.5, '150000'])('rejects an invalid fixed discount %s', team_discount_price => expect(() => validateAction('game.save', { ...game, team_discount_price })).toThrow())
  it('accepts a per-position discounted amount', () => expect(validateAction('game.save', { ...game, positions: { ...game.positions, setter: { capacity: 4, price: 30000, discount_price: 25000 } } }).positions).toHaveProperty('setter.discount_price', 25000))
  it('rejects a position discount above its own price', () => expect(() => validateAction('game.save', { ...game, positions: { ...game.positions, setter: { capacity: 4, price: 30000, discount_price: 30001 } } })).toThrow())
  it('supports clearing an existing discount', () => expect(validateAction('game.save', { ...game, team_discount_price: null }).team_discount_price).toBeNull())
})
describe('announcement validation and permission boundaries', () => {
  const announcement = { title: ' Schedule update ', body: ' Please check the updated venue. ', enabled: true, publish_at: '2027-01-05T10:00:00Z', ends_at: '2027-01-05T12:00:00Z' }
  it('normalizes plain-text announcement content', () => expect(validateAction('announcement.save', announcement)).toMatchObject({ title: 'Schedule update', body: 'Please check the updated venue.' }))
  it.each([
    { publish_at: undefined },
    { ends_at: undefined },
    { ends_at: announcement.publish_at },
    { ends_at: '2027-01-04T12:00:00Z' },
    { publish_at: '2027-02-30T10:00:00Z' },
  ])('rejects missing or invalid schedules (%o)', schedule => {
    expect(() => validateAction('announcement.save', { ...announcement, ...schedule })).toThrow()
  })
  it('requires content rather than publishing an empty banner', () => expect(() => validateAction('announcement.save', { ...announcement, body: ' ' })).toThrow())
  it('limits announcement content length', () => expect(() => validateAction('announcement.save', { ...announcement, body: 'a'.repeat(1501) })).toThrow())
  it('requires a boolean publication state', () => expect(() => validateAction('announcement.save', { ...announcement, enabled: 'true' })).toThrow())
  it.each(['coordinator','admin','developer'] as const)('%s can manage announcements', role => expect(canAct(role, 'announcement.save')).toBe(true))
  it.each(['player','facilitator'] as const)('%s cannot manage announcements', role => expect(canAct(role, 'announcement.save')).toBe(false))
  it.each(['player','facilitator','coordinator','admin','developer'] as const)('%s cannot execute an unknown action', role => expect(canAct(role, 'unknown.action')).toBe(false))
})
