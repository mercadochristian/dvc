import { describe, expect, it } from 'vitest'
import { validateCheckoutDraft, validateCheckoutHoldDraft } from '@/features/club/model/validation'
const id = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222'
const profile = { level: 'intermediate', gender: 'female', birth_date: '1995-04-12', first_timer: false }
const player = { ...profile, name: 'Ana', position: 'setter', is_registrant: true, has_details: true }
const draft = () => ({ request_id: id, organizer: { name: 'Ana', contact: '09123456789', email: 'ANA@example.test' }, games: [{ game_id: id, kind: 'individual', organizer_plays: true, players: [structuredClone(player)] }] })
const slot = (position = 'setter') => ({ ...profile, name: 'Ben', position, is_registrant: false, has_details: true })
const group = (count = 2) => ({ ...draft(), games: [{ game_id: id, kind: 'group', organizer_plays: false, players: Array.from({ length: count }, () => slot()) }] })
const snapshot = () => ({ venue: 'Court', city: 'Manila', maps_url: null, starts_at: '2027-01-05T10:00:00+00:00', ends_at: '2027-01-05T12:00:00+00:00', team_price: 150000, position_prices: { setter: 25000 } })
describe('canonical checkout registration validation', () => {
  it('normalizes an explicit confirmation recipient', () => expect(validateCheckoutDraft(draft()).organizer.email).toBe('ana@example.test'))
  it.each([undefined, null, '', 'wrong', 'a@example.test\r\nBcc:b@example.test'])('requires a valid organizer email %s', email => expect(() => validateCheckoutDraft({ ...draft(), organizer: { ...draft().organizer, email } })).toThrow('email'))
  it('rejects an invalid request key', () => expect(() => validateCheckoutDraft({ ...draft(), request_id: 'retry' })).toThrow('ID'))
  it('requires at least one selected game', () => expect(() => validateCheckoutDraft({ ...draft(), games: [] })).toThrow('at least one'))
  it('rejects duplicate game IDs including case variants', () => expect(() => validateCheckoutDraft({ ...draft(), games: [draft().games[0], { ...draft().games[0], game_id: id.toUpperCase() }] })).toThrow('only once'))
  it('keeps each distinct game and organizer participation separate', () => expect(validateCheckoutDraft({ ...draft(), games: [draft().games[0], { ...group().games[0], game_id: second }] }).games.map(game => game.organizer_plays)).toEqual([true, false]))
  it('does not accept unknown registration kinds', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], kind: 'squad' }] })).toThrow('individual, group, or team'))
  it.each([0, 1, 6])('rejects group boundary %s', count => expect(() => validateCheckoutDraft(group(count))).toThrow('2–5'))
  it.each([2, 5])('allows %s repeated group positions without team-composition rules', count => expect(validateCheckoutDraft(group(count)).games[0].players.map(player => player.position)).toEqual(Array(count).fill('setter')))
  it('requires exactly one player for individual registration', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], players: [player, player] }] })).toThrow('one player'))
  it('allows a named individual registered by a non-playing organizer', () => expect(validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], organizer_plays: false, players: [{ ...player, name: 'Ben', is_registrant: false }] }] }).games[0].players[0].name).toBe('Ben'))
  it('requires the other individual player to be named', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], organizer_plays: false, players: [{ name: null, position: 'setter', is_registrant: false, has_details: true }] }] })).toThrow('player name'))
  it('requires an explicit organizer participation boolean', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], organizer_plays: 'false' }] })).toThrow('participation'))
  it('does not create an implicit organizer player', () => expect(() => validateCheckoutDraft({ ...group(), games: [{ ...group().games[0], organizer_plays: true }] })).toThrow('exactly one'))
  it('rejects multiple organizer seats', () => expect(() => validateCheckoutDraft({ ...group(), games: [{ ...group().games[0], organizer_plays: true, players: [player, player] }] })).toThrow('exactly one'))
  it('rejects an organizer seat when organizer is not playing', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], organizer_plays: false }] })).toThrow('exactly one'))
  it('requires the organizer seat to use the organizer name', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], players: [{ ...player, name: 'Ben' }] }] })).toThrow('organizer name'))
  it('does not allow an unnamed organizer player', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], players: [{ ...player, name: null }] }] })).toThrow('player name'))
  it('requires explicit player ownership flags', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], players: [{ ...player, is_registrant: undefined }] }] })).toThrow('organizer player slot'))
  it('requires names even when all group player profile fields exist', () => expect(() => validateCheckoutDraft({ ...group(), games: [{ ...group().games[0], players: [{ ...slot(), name: null }, slot()] }] })).toThrow('player name'))
  it('requires player names independently of optional email', () => expect(() => validateCheckoutDraft({ ...group(), games: [{ ...group().games[0], players: [{ ...slot(), name: null, email: 'ben@example.test' }, slot()] }] })).toThrow('player name'))
  it('requires complete named teammate profiles', () => expect(() => validateCheckoutDraft({ ...group(), games: [{ ...group().games[0], players: [{ ...slot(), name: 'Ben', birth_date: null }, slot()] }] })).toThrow('birthday'))
  it('requires an editable explicit first-timer value for named players', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], players: [{ ...player, first_timer: null }] }] })).toThrow('first-timer'))
  it('does not invent birthdays from legacy ages', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], players: [{ ...player, age: 25, birth_date: null }] }] })).toThrow('birthday'))
  it('rejects a nonexistent player position', () => expect(() => validateCheckoutDraft({ ...group(), games: [{ ...group().games[0], players: [slot('libero'), slot()] }] })).toThrow('position'))
  it('accepts complete team players at the minimum composition', () => expect(validateCheckoutDraft({ ...draft(), games: [{ game_id: id, kind: 'team', organizer_plays: false, players: ['open','open','opposite','middle','middle','setter'].map(position => slot(position)) }] }).games[0].players).toHaveLength(6))
  it('rejects a six-player team with the wrong composition', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ game_id: id, kind: 'team', organizer_plays: false, players: Array.from({ length: 6 }, () => slot()) }] })).toThrow('2 Open'))
  it('rejects a team with only five players', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...group(5).games[0], kind: 'team' }] })).toThrow('six players'))
  it.each([7, 12, 30])('accepts %s fully detailed team players with at least the minimum core', count => {
    const positions = ['open','open','opposite','middle','middle','setter', ...Array(count - 6).fill('open')]
    const value = { ...draft(), games: [{ game_id: id, kind: 'team', organizer_plays: false, players: positions.map(position => slot(position)) }] }
    expect(validateCheckoutDraft(value).games[0].players).toHaveLength(count)
  })
  it('rejects a large team missing a required core position', () => {
    const value = { ...draft(), games: [{ game_id: id, kind: 'team', organizer_plays: false, players: Array.from({ length: 12 }, () => slot('open')) }] }
    expect(() => validateCheckoutDraft(value)).toThrow('at least 2 Open')
  })
  it('requires every additional player to supply a complete profile', () => {
    const players = ['open','open','opposite','middle','middle','setter','open'].map(position => slot(position))
    const value = { ...draft(), games: [{ game_id: id, kind: 'team', organizer_plays: false, players: [...players.slice(0, 6), { ...players[6], birth_date: null }] }] }
    expect(() => validateCheckoutDraft(value)).toThrow('birthday')
  })
  it('allows a position-only individual and an organizer without fabricated profile details', () => {
    const value = { ...draft(), games: [{ ...draft().games[0], players: [{ position: 'setter', name: null, is_registrant: true, has_details: false }] }] }
    expect(validateCheckoutDraft(value).games[0].players).toEqual([{ position: 'setter', name: null, is_registrant: true, has_details: false, email: null }])
  })
  it('requires the optional-details choice to be an explicit boolean for new reviews', () => {
    const value = draft(); delete (value.games[0].players[0] as Partial<typeof player>).has_details
    expect(() => validateCheckoutDraft(value)).toThrow('whether to add')
  })
  it('rejects partial personal information when details are not selected', () => {
    const value = { ...draft(), games: [{ ...draft().games[0], players: [{ position: 'setter', name: null, is_registrant: true, has_details: false, gender: 'female' }] }] }
    expect(() => validateCheckoutDraft(value)).toThrow('Clear player details')
  })
  it('accepts only legacy unnamed transport on the consented hold retry boundary', () => {
    const value = { ...draft(), games: [{ ...group().games[0], players: [1,2].map(() => ({ position: 'setter', name: null, is_registrant: false })), expected_amount: 50000, expected_quote: snapshot() }] }
    expect(() => validateCheckoutDraft(value)).toThrow('whether to add player details')
    expect(validateCheckoutHoldDraft(value).games[0].players).toEqual([1,2].map(() => ({ position: 'setter', name: null, is_registrant: false, email: null })))
  })
  it('strips client prices and previously reviewed consent from a fresh review', () => expect(validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], amount: 1, expected_amount: 1, expected_quote: snapshot() }] }).games[0]).not.toHaveProperty('expected_amount'))
  it('requires reviewed amount before hold', () => expect(() => validateCheckoutDraft(draft(), true)).toThrow('reviewed game total'))
  it('requires the reviewed schedule and unit prices before hold', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], expected_amount: 25000 }] }, true)).toThrow('Invalid request'))
  it('preserves per-position prices independently of the combined total', () => expect(validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], expected_amount: 25000, expected_quote: snapshot() }] }, true).games[0].expected_quote?.position_prices).toEqual({ setter: 25000 }))
  it('rejects missing selected position prices', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], expected_amount: 25000, expected_quote: { ...snapshot(), position_prices: {} } }] }, true)).toThrow('position prices'))
  it('rejects unselected position prices in the consent snapshot', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], expected_amount: 25000, expected_quote: { ...snapshot(), position_prices: { setter: 25000, open: 30000 } } }] }, true)).toThrow('position prices'))
  it('rejects ambiguous schedule times without a timezone', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], expected_amount: 25000, expected_quote: { ...snapshot(), starts_at: '2027-01-05T10:00:00' } }] }, true)).toThrow('schedule'))
  it('rejects a reversed schedule snapshot', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], expected_amount: 25000, expected_quote: { ...snapshot(), ends_at: '2027-01-04T10:00:00Z' } }] }, true)).toThrow('schedule'))
  it('rejects injected map links', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], expected_amount: 25000, expected_quote: { ...snapshot(), maps_url: 'javascript:alert(1)' } }] }, true)).toThrow('map'))
  it('preserves valid venue maps longer than 2000 characters', () => { const maps = 'https://www.google.com/maps?q=' + 'x'.repeat(1990); expect(validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], expected_amount: 25000, expected_quote: { ...snapshot(), maps_url: maps } }] }, true).games[0].expected_quote?.maps_url).toBe(maps) })
  it('rejects venue maps beyond the existing 2048-character limit', () => expect(() => validateCheckoutDraft({ ...draft(), games: [{ ...draft().games[0], expected_amount: 25000, expected_quote: { ...snapshot(), maps_url: 'https://www.google.com/maps?q=' + 'x'.repeat(2048) } }] }, true)).toThrow('map'))
})
