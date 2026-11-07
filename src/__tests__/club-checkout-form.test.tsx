import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { addCheckoutPlayer, additionalPlayerPosition, changeOrganizerParticipation, changePlayerPosition, checkoutCapacityWarning, checkoutDraftFrom, checkoutFormEstimate, initialCheckoutForm, missingTeamPositions, playerPositionAvailability, registrationKind, quotedCheckoutDraft, removeCheckoutPlayer, teamAvailable, validTeamComposition, type CheckoutForm } from '@/features/club/model/checkout-form'
import { POSITIONS, type CheckoutDraft, type CheckoutQuote, type ClubGame, type ClubSession, type RegistrationProfile } from '@/features/club/model/types'
import { CheckoutDetails } from '@/features/club/ui/registration/checkout-details'
import { CheckoutPlayer } from '@/features/club/ui/registration/checkout-player'
import { CheckoutReview } from '@/features/club/ui/registration/checkout-review'

const game: ClubGame = { id: '11111111-1111-4111-8111-111111111111', venue: 'QA Court', city: 'Makati', starts_at: '2026-11-05T10:00:00Z', ends_at: '2026-11-05T12:00:00Z', status: 'published', team_price: 165000, positions: POSITIONS.map((position, index) => ({ position, available: 5, capacity: 6, price: 30000 + index * 1000 })) }
const session: ClubSession = { configured: true, user: { id: 'own', name: 'Ana', email: 'ana@example.test' }, role: 'player', developer: false }
const profile = { name: 'Ana', contact: '+639000000000', position: 'setter', level: 'intermediate', gender: 'female', birth_date: '2000-11-06', age: null, first_timer: false } satisfies RegistrationProfile
const requestId = '22222222-2222-4222-8222-222222222222'
const noop = () => undefined
function consent(draft: CheckoutDraft, reviewed: CheckoutQuote, snapshot = draft) { return quotedCheckoutDraft(draft, { draft: snapshot, quote: reviewed }) }
function form(): CheckoutForm { return initialCheckoutForm([game], session, profile) }
function fixtureGroupCount(entry: ReturnType<typeof form>['games'][number], count: number) {
  let changed = entry
  while (changed.players.length < count) changed = addCheckoutPlayer(changed)
  return changed
}
function fixtureKind(entry: ReturnType<typeof form>['games'][number], kind: 'individual' | 'group' | 'team') {
  return fixtureGroupCount(entry, kind === 'team' ? 6 : kind === 'group' ? 2 : 1)
}

function quote(value = form()): CheckoutQuote {
  const draft = checkoutDraftFrom(value, requestId)
  const games = draft.games.map((entry, index) => ({ ...entry, amount: checkoutFormEstimate(value.games[index]), venue: game.venue, city: game.city, maps_url: null, starts_at: game.starts_at, ends_at: game.ends_at, quote: { venue: game.venue, city: game.city, maps_url: null, starts_at: game.starts_at, ends_at: game.ends_at, team_price: game.team_price, position_prices: Object.fromEntries(game.positions.filter(slot => entry.players.some(player => player.position === slot.position)).map(slot => [slot.position, slot.price])) } }))
  return { games, amount: games.reduce((amount, entry) => amount + entry.amount, 0) }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T04:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe('checkout participant drafts', () => {
  it('autofills only the signed-in own player from the supplied own profile', () => expect(form().games[0].players[0]).toMatchObject({ position: 'setter', birth_date: '2000-11-06', first_timer: false, is_registrant: true }))
  it('uses the signed-in email instead of the saved contact', () => expect(form().organizer).toMatchObject({ contact: 'ana@example.test', email: 'ana@example.test' }))
  it('does not infer returnee status from account existence', () => expect(initialCheckoutForm([game], session).games[0].players[0].first_timer).toBeNull())
  it('leaves a legacy age-only birthday blank', () => expect(initialCheckoutForm([game], session, { ...profile, birth_date: null, age: 25 }).games[0].players[0].birth_date).toBe(''))
  it('uses an available position when the saved position is full', () => expect(initialCheckoutForm([{ ...game, positions: game.positions.map(slot => ({ ...slot, available: slot.position === 'setter' ? 0 : 4 })) }], session, profile).games[0].players[0].position).toBe('open'))
  it('creates two independent game entries for a multi-game selection', () => expect(initialCheckoutForm([game, { ...game, id: '33333333-3333-4333-8333-333333333333' }], session, profile).games.map(entry => entry.game.id)).toEqual([game.id, '33333333-3333-4333-8333-333333333333']))
  it('starts a flexible group with two players', () => expect(fixtureKind(form().games[0], 'group').players).toHaveLength(2))
  it('never autofills organizer history into an additional group player', () => expect(fixtureKind(form().games[0], 'group').players[1]).toMatchObject({ name: '', birth_date: '', first_timer: null, is_registrant: false }))
  it('supports the upper five-player group boundary', () => expect(fixtureGroupCount(fixtureKind(form().games[0], 'group'), 5).players).toHaveLength(5))
  it('allows repeated positions in a flexible group', () => { const entry = fixtureKind(form().games[0], 'group'); expect(changePlayerPosition(entry, 1, 'setter').players.map(player => player.position)).toEqual(['setter', 'setter']) })
  it('sums every repeated position at its effective price', () => { const entry = changePlayerPosition(fixtureKind(form().games[0], 'group'), 1, 'setter'); expect(checkoutFormEstimate(entry)).toBe(66000) })
  it('does not lose a zero-price discount in a flexible group', () => { const entry = fixtureKind(form().games[0], 'group'); expect(checkoutFormEstimate({ ...entry, game: { ...game, positions: game.positions.map(slot => ({ ...slot, discount_price: 0 })) } })).toBe(0) })
  it('retains fixed team composition when the organizer chooses Setter', () => expect(fixtureKind(form().games[0], 'team').players.map(player => player.position)).toEqual(['setter', 'open', 'open', 'opposite', 'middle', 'middle']))
  it('changes only the organizer position and leaves fixed composition for explicit correction', () => { const entry = changePlayerPosition(fixtureKind(form().games[0], 'team'), 0, 'middle'); expect(entry.players.map(player => player.position)).toEqual(['middle', 'open', 'open', 'opposite', 'middle', 'middle']); expect(validTeamComposition(entry)).toBe(false) })
  it('prices a fixed team as one team total', () => expect(checkoutFormEstimate(fixtureKind(form().games[0], 'team'))).toBe(165000))
  it('uses the effective discounted fixed team total', () => { const entry = fixtureKind(form().games[0], 'team'); expect(checkoutFormEstimate({ ...entry, game: { ...game, team_discount_price: 150000 } })).toBe(150000) })
  it('removes organizer identity and profile from a non-playing group slot', () => { const entry = changeOrganizerParticipation(fixtureKind(form().games[0], 'group'), false, profile); expect(entry.players[0]).toMatchObject({ name: '', is_registrant: false, birth_date: '', first_timer: null }) })
  it('keeps all six positions and team pricing when the organizer stops playing', () => { const entry = fixtureKind(form().games[0], 'team'); const changed = changeOrganizerParticipation(entry, false, profile); expect(changed.players).toHaveLength(6); expect(changed.players.slice(1)).toEqual(entry.players.slice(1)); expect(changed.players[0]).toMatchObject({ position: entry.players[0].position, form_id: entry.players[0].form_id, is_registrant: false, has_details: false }); expect(changed.kind).toBe('team'); expect(checkoutFormEstimate(changed)).toBe(checkoutFormEstimate(entry)); expect(validTeamComposition(changed)).toBe(true) })
  it('does not mutate the existing player list when changing position', () => { const entry = form().games[0]; changePlayerPosition(entry, 0, 'open'); expect(entry.players[0].position).toBe('setter') })
})

describe('normalized review and price consent', () => {
  it('derives the organizer player name from the organizer field', () => { const value = form(); value.organizer.name = ' Maria '; expect(checkoutDraftFrom(value, requestId).games[0].players[0].name).toBe('Maria') })
  it('keeps review input free of client-authoritative amounts', () => expect(checkoutDraftFrom(form(), requestId).games[0]).not.toHaveProperty('expected_amount'))
  it('supports an organizer-only position-only individual registration', () => { const value = form(); value.games[0] = changeOrganizerParticipation(value.games[0], false); expect(checkoutDraftFrom(value, requestId).games[0].players[0]).toMatchObject({ name: null, has_details: false, is_registrant: false }) })
  it('retains all unnamed group positions without private profile fields', () => { const value = form(); value.games[0] = changeOrganizerParticipation(fixtureKind(value.games[0], 'group'), false); const player = checkoutDraftFrom(value, requestId).games[0].players[0]; expect(player).toEqual({ position: 'setter', name: null, has_details: false, is_registrant: false, email: null }) })
  it('omits personal fields when details are unchecked without clearing the editable draft', () => { const value = form(); value.games[0] = fixtureKind(value.games[0], 'group'); value.games[0].players[1] = { ...value.games[0].players[0], has_details: false, name: 'Bea', is_registrant: false }; expect(checkoutDraftFrom(value, requestId).games[0].players[1]).not.toHaveProperty('birth_date'); expect(value.games[0].players[1]).toMatchObject({ name: 'Bea', birth_date: profile.birth_date }); expect(checkoutDraftFrom(value, requestId).games[0].players[1].name).toBeNull() })
  it('requires complete details for a named group teammate', () => { const value = form(); value.games[0] = fixtureKind(value.games[0], 'group'); value.games[0].players[1].has_details = true; value.games[0].players[1].name = 'Bea'; expect(() => checkoutDraftFrom(value, requestId)).toThrow('level') })
  it('keeps an incomplete legacy profile unchecked until the player opts in, then requires birthday', () => { const value = initialCheckoutForm([game], session, { ...profile, birth_date: null, age: 25 }); expect(value.games[0].players[0].has_details).toBe(false); expect(checkoutDraftFrom(value, requestId).games[0].players[0].name).toBeNull(); value.games[0].players[0].has_details = true; expect(() => checkoutDraftFrom(value, requestId)).toThrow('birthday') })
  it('retains editable first-timer choice rather than deriving it from email', () => { const value = form(); value.games[0].players[0].first_timer = true; expect(checkoutDraftFrom(value, requestId).games[0].players[0].first_timer).toBe(true) })
  it.each([
    [' ANA@EXAMPLE.TEST ', 'ana@example.test', 'ana@example.test'],
    ['m.me/ana', 'https://m.me/ana', null],
    ['https://www.facebook.com/profile.php?id=123', 'https://www.facebook.com/profile.php?id=123', null],
  ])('uses one contact channel for %s', (contact, expected, email) => {
    const value = form()
    value.organizer = { ...value.organizer, contact, email: '' }
    expect(checkoutDraftFrom(value, requestId).organizer).toMatchObject({ contact: expected, email })
  })
  it.each(['+639000000000', 'https://facebook.com.evil.test/ana', 'https://other.test@facebook.com/ana'])('rejects invalid contact %s', contact => {
    const value = form()
    value.organizer = { ...value.organizer, contact, email: '' }
    expect(() => checkoutDraftFrom(value, requestId)).toThrow()
  })
  it('normalizes a valid confirmation email', () => { const value = form(); value.organizer.email = ' ANA@EXAMPLE.TEST '; expect(checkoutDraftFrom(value, requestId).organizer.email).toBe('ana@example.test') })
  it('attaches the exact reviewed per-position and schedule snapshot before hold', () => { const draft = checkoutDraftFrom(form(), requestId), reviewed = quote(); expect(consent(draft, reviewed).games[0].expected_quote).toEqual(reviewed.games[0].quote) })
  it('attaches the reviewed per-game subtotal rather than recalculating it', () => { const draft = checkoutDraftFrom(form(), requestId), reviewed = quote(); reviewed.games[0].amount = 32000; expect(consent(draft, reviewed).games[0].expected_amount).toBe(32000) })
  it('rejects a quote for a different game', () => { const draft = checkoutDraftFrom(form(), requestId), reviewed = quote(); reviewed.games[0].game_id = '33333333-3333-4333-8333-333333333333'; expect(() => consent(draft, reviewed)).toThrow('Review') })
  it('rejects a duplicated quote game rather than submitting a partial checkout', () => { const draft = checkoutDraftFrom(form(), requestId), reviewed = quote(); reviewed.games.push(reviewed.games[0]); expect(() => consent(draft, reviewed)).toThrow('Review') })
})

describe('controlled registration presentation', () => {
  it('derives the registration type without radio options or a count selector', () => { const html = renderToStaticMarkup(<CheckoutDetails navigate={noop} step={{ kind: 'game', gameId: game.id }} value={form()} update={noop} signedIn busy={false} submit={noop} />); expect(html).toContain('Your player details'); expect(html).toContain('>Next</button>'); expect(html).not.toContain('Register other players or a team?'); expect(html).not.toContain('Add another player'); expect(html).not.toContain('Registration option'); expect(html).not.toContain('Number of players') })
  it('shows the group count next to its automatic classification', () => { const value = form(); value.games[0] = addCheckoutPlayer(value.games[0]); expect(renderToStaticMarkup(<CheckoutDetails navigate={noop} step={{ kind: 'game', gameId: game.id }} value={value} update={noop} signedIn busy={false} submit={noop} />)).toContain('2 players · Group registration') })
  it('requires a name when an individual other-player opts into details', () => { const entry = changeOrganizerParticipation(form().games[0], false); entry.players[0].has_details = true; expect(renderToStaticMarkup(<CheckoutPlayer player={entry.players[0]} index={0} kind="individual" organizerName="Ana" game={game} update={noop} />)).toMatch(/<input[^>]*required=""[^>]*value=""/) })
  it('shows no balancing fields for an unnamed group placeholder', () => { const player = fixtureKind(form().games[0], 'group').players[1]; expect(renderToStaticMarkup(<CheckoutPlayer player={player} index={1} kind="group" organizerName="Ana" game={game} update={noop} />)).not.toContain('type="date"') })
  it('keeps the calculated age out of the form', () => expect(renderToStaticMarkup(<CheckoutPlayer player={form().games[0].players[0]} index={0} kind="individual" organizerName="Ana" game={game} update={noop} />)).not.toContain('calculated from birthday'))
  it('provides no manually editable age input', () => expect(renderToStaticMarkup(<CheckoutPlayer player={form().games[0].players[0]} index={0} kind="individual" organizerName="Ana" game={game} update={noop} />)).not.toContain('type="number"'))
  it('marks named player birthday required visibly and semantically', () => expect(renderToStaticMarkup(<CheckoutPlayer player={form().games[0].players[0]} index={0} kind="individual" organizerName="Ana" game={game} update={noop} />)).toMatch(/Birthday<span class="club-required"[^]*type="date" required=""/))
  it('shows server-reviewed game and checkout totals before hold', () => expect(renderToStaticMarkup(<CheckoutReview draft={checkoutDraftFrom(form(), requestId)} quote={quote()} busy={false} edit={noop} confirm={noop} />)).toContain('Checkout total'))
  it('explains that Register starts the hold after slot confirmation', () => expect(renderToStaticMarkup(<CheckoutReview draft={checkoutDraftFrom(form(), requestId)} quote={quote()} busy={false} edit={noop} confirm={noop} />)).toContain('Register starts a 10-minute hold once your slots are confirmed.'))
  it('disables duplicate hold confirmation while busy', () => expect(renderToStaticMarkup(<CheckoutReview draft={checkoutDraftFrom(form(), requestId)} quote={quote()} busy edit={noop} confirm={noop} />)).toMatch(/<button[^>]*disabled=""[^>]*>Reserving…<\/button>/))
})

describe('named player identity during registration edits', () => {
  function namedTeam() {
    const entry = fixtureKind(form().games[0], 'team')
    return { ...entry, players: entry.players.map((player, index) => index === 0 ? player : { ...player, name: `Player ${index}`, level: 'intermediate' as const, gender: 'female' as const, birth_date: '1990-01-01', first_timer: true }) }
  }
  it('changing the organizer position never changes another named player position', () => {
    const entry = namedTeam(), changed = changePlayerPosition(entry, 0, 'middle')
    expect(changed.players.slice(1)).toEqual(entry.players.slice(1))
  })
  it('a named group player keeps their position when switching to a team', () => {
    const entry = fixtureKind(form().games[0], 'group')
    entry.players[1] = { ...entry.players[1], name: 'Bea', position: 'opposite' }
    expect(fixtureKind(entry, 'team').players.find(player => player.name === 'Bea')?.position).toBe('opposite')
  })
  it('incompatible named repeated group positions stay explicit rather than being reassigned', () => {
    const entry = fixtureGroupCount(fixtureKind(form().games[0], 'group'), 3)
    entry.players = entry.players.map((player, index) => ({ ...player, name: `Name ${index}`, position: 'setter' }))
    expect(fixtureKind(entry, 'team').players.filter(player => player.name).map(player => player.position)).toEqual(['setter', 'setter', 'setter'])
  })
  it('removes the specifically chosen group player without changing other identities', () => {
    const entry = fixtureGroupCount(fixtureKind(form().games[0], 'group'), 3)
    entry.players[1].name = 'Bea'; entry.players[2].name = 'Cara'
    expect(removeCheckoutPlayer(entry, 1).players).toEqual([entry.players[0], entry.players[2]])
  })
  it('never removes the organizer player through an other-player action', () => {
    const entry = fixtureKind(form().games[0], 'group')
    expect(removeCheckoutPlayer(entry, 0)).toBe(entry)
  })
  it('removes a specifically chosen team player and derives the remaining group', () => {
    const entry = namedTeam(), changed = removeCheckoutPlayer(entry, 3)
    expect(changed.players).toEqual(entry.players.filter((_, index) => index !== 3))
    expect(changed.kind).toBe('group')
  })
  it('returns to individual registration after removing the second player', () => {
    const entry = fixtureKind(form().games[0], 'group'); entry.players[1].name = 'Bea'
    expect(removeCheckoutPlayer(entry, 1).players).toHaveLength(1); expect(removeCheckoutPlayer(entry, 1).kind).toBe('individual')
  })
  it('never imposes fixed-team composition on a flexible group', () => {
    const entry = fixtureGroupCount(fixtureKind(form().games[0], 'group'), 5)
    entry.players = entry.players.map(player => ({ ...player, position: 'setter' }))
    expect(validTeamComposition(entry)).toBe(true)
  })
  it('lets a user explicitly correct a team position instead of moving another profile', () => {
    const entry = namedTeam(), changed = changePlayerPosition(entry, 0, 'middle')
    expect(validTeamComposition(changePlayerPosition(changed, 5, 'setter'))).toBe(true)
  })
  it('adds the organizer without replacing a named other player when capacity allows', () => {
    const entry = changeOrganizerParticipation(form().games[0], false)
    entry.players[0] = { ...entry.players[0], name: 'Bea', birth_date: '1990-02-03' }
    const changed = changeOrganizerParticipation(entry, true, profile)
    expect(changed.players[0]).toEqual(entry.players[0]); expect(changed.players[1].is_registrant).toBe(true); expect(changed.kind).toBe('group')
  })
  it('uses an unnamed slot when the organizer joins without overwriting named Player 1', () => {
    const entry = changeOrganizerParticipation(fixtureKind(form().games[0], 'group'), false)
    entry.players[0] = { ...entry.players[0], name: 'Bea', birth_date: '1990-02-03' }
    const changed = changeOrganizerParticipation(entry, true, profile)
    expect(changed.players.find(player => player.name === 'Bea')).toEqual(entry.players[0])
    expect(changed.players.filter(player => player.is_registrant)).toHaveLength(1)
  })
  it('turning organizer participation off replaces only the actual registrant with a same-position placeholder', () => {
    const entry = fixtureKind(form().games[0], 'group')
    entry.players = [{ ...entry.players[1], name: 'Bea' }, entry.players[0]]
    const changed = changeOrganizerParticipation(entry, false)
    expect(changed.players[0]).toEqual(entry.players[0])
    expect(changed.players[0]).toBe(entry.players[0])
    expect(changed.players[1]).toMatchObject({ form_id: entry.players[1].form_id, position: entry.players[1].position, has_details: false, is_registrant: false, name: '' })
    expect(changed.players).toHaveLength(entry.players.length)
  })
})

describe('stale same-game quote rejection', () => {
  it('rejects a quote that would change an individual to a group', () => {
    const draft = checkoutDraftFrom(form(), requestId), value = form()
    value.games[0] = fixtureKind(value.games[0], 'group')
    expect(() => consent(draft, quote(value))).toThrow('Review')
  })
  it('rejects a quote that would overwrite another player name', () => {
    const value = form(); value.games[0] = changeOrganizerParticipation(value.games[0], false)
    value.games[0].players[0] = { ...value.games[0].players[0], ...profile, name: 'Bea', birth_date: profile.birth_date!, email: '' }
    const draft = checkoutDraftFrom(value, requestId), reviewed = quote(value)
    reviewed.games[0].players[0].name = 'Other player'
    expect(() => consent(draft, reviewed)).toThrow('Review')
  })
  it('rejects a same-game quote for a different position', () => {
    const value = form(), draft = checkoutDraftFrom(value, requestId)
    value.games[0] = changePlayerPosition(value.games[0], 0, 'open')
    expect(() => consent(draft, quote(value))).toThrow('Review')
  })
  it.each(['contact', 'email'] as const)('rejects an edited organizer %s against the paired reviewed input', field => {
    const snapshot = checkoutDraftFrom(form(), requestId), reviewed = quote()
    const current = { ...snapshot, organizer: { ...snapshot.organizer, [field]: field === 'email' ? 'new@example.test' : '+639111111111' } }
    expect(() => consent(current, reviewed, snapshot)).toThrow('Review')
  })
  it('rejects an edited organizer name against the paired reviewed input', () => {
    const snapshot = checkoutDraftFrom(form(), requestId), reviewed = quote(), current = structuredClone(snapshot)
    current.organizer.name = 'Maria'; current.games[0].players[0].name = 'Maria'
    expect(() => consent(current, reviewed, snapshot)).toThrow('Review')
  })
  it('rejects an edited birthday against the reviewed participant snapshot', () => {
    const snapshot = checkoutDraftFrom(form(), requestId), reviewed = quote(), current = structuredClone(snapshot)
    current.games[0].players[0].birth_date = '1999-01-02'
    expect(() => consent(current, reviewed, snapshot)).toThrow('Review')
  })
  it('rejects an edited first-timer choice against the reviewed participant snapshot', () => {
    const snapshot = checkoutDraftFrom(form(), requestId), reviewed = quote(), current = structuredClone(snapshot)
    current.games[0].players[0].first_timer = true
    expect(() => consent(current, reviewed, snapshot)).toThrow('Review')
  })
  it('rejects a quote paired with a different request ID', () => {
    const snapshot = checkoutDraftFrom(form(), requestId), reviewed = quote()
    expect(() => consent({ ...snapshot, request_id: '33333333-3333-4333-8333-333333333333' }, reviewed, snapshot)).toThrow('Review')
  })
  it('accepts canonical whitespace/email normalization without replacing participant input', () => {
    const snapshot = checkoutDraftFrom(form(), requestId), reviewed = quote(), current = structuredClone(snapshot)
    current.organizer.contact = ` ${current.organizer.contact} `; current.organizer.email = ' ANA@EXAMPLE.TEST '
    expect(consent(current, reviewed, snapshot).games[0].players).toEqual(snapshot.games[0].players)
  })
  it('rejects a same-game response pair with changed organizer participation', () => {
    const snapshot = checkoutDraftFrom(form(), requestId), reviewed = quote()
    reviewed.games[0].organizer_plays = false; reviewed.games[0].players[0].is_registrant = false
    expect(() => consent(snapshot, reviewed, snapshot)).toThrow('Review')
  })
})

describe('capacity feedback without changing selected players', () => {
  it('subtracts another selected group player from a repeated-position choice', () => {
    const entry = changePlayerPosition(fixtureKind(form().games[0], 'group'), 1, 'setter')
    entry.game = { ...game, positions: game.positions.map(slot => ({ ...slot, available: slot.position === 'setter' ? 1 : 5 })) }
    expect(playerPositionAvailability(entry, 0).setter).toBe(0)
  })
  it('does not subtract the player whose position is being edited', () => expect(playerPositionAvailability(form().games[0], 0).setter).toBe(5))
  it('warns about stale over-capacity selection while preserving it', () => {
    const entry = form().games[0]; entry.game = { ...game, positions: game.positions.map(slot => ({ ...slot, available: slot.position === 'setter' ? 0 : 5 })) }
    expect(checkoutCapacityWarning(entry)).toContain('available slots')
    expect(entry.players[0].position).toBe('setter')
  })
  it('keeps flexible groups unrestricted when repeated positions fit capacity', () => {
    const entry = changePlayerPosition(fixtureKind(form().games[0], 'group'), 1, 'setter')
    expect(checkoutCapacityWarning(entry)).toBeNull()
  })
  it('rejects a new full-team choice when there is no whole team available', () => expect(teamAvailable({ ...game, available_teams: 0 })).toBe(false))
  it('rejects a new full-team choice when one required position is insufficient', () => expect(teamAvailable({ ...game, positions: game.positions.map(slot => ({ ...slot, available: slot.position === 'middle' ? 1 : 5 })) })).toBe(false))
  it('warns when a selected fixed team is no longer available', () => {
    const entry = fixtureKind(form().games[0], 'team'); entry.game = { ...game, available_teams: 0 }
    expect(checkoutCapacityWarning(entry)).toContain('full team')
  })
  it('disables a new known-full position without disabling the current selection', () => {
    const player = form().games[0].players[0], availability = { open: 0, opposite: 5, middle: 5, setter: 0 }
    const snapshot = { ...game, positions: game.positions.map(slot => ({ ...slot, available: slot.position === 'open' ? 0 : 5 })) }
    const html = renderToStaticMarkup(<CheckoutPlayer player={player} index={0} kind="group" organizerName="Ana" game={snapshot} availability={availability} update={noop} />)
    expect(html).toMatch(/<option(?=[^>]*value="open")(?=[^>]*disabled="")/)
    expect(html.match(/<option[^>]*value="setter"[^>]*>/)?.[0]).not.toContain('disabled')
  })
  it('keeps an unavailable current team selectable while showing the capacity warning', () => {
    const value = form(); value.games[0] = fixtureKind(value.games[0], 'team'); value.games[0].game = { ...game, available_teams: 0 }
    const html = renderToStaticMarkup(<CheckoutDetails navigate={noop} step={{ kind: 'game', gameId: game.id }} value={value} update={noop} signedIn busy={false} submit={noop} />)
    expect(html).toContain('A full team is no longer available')
    expect(html).toContain('6 players · Team registration'); expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue to contact/)
  })
  it('disables adding a sixth player when no whole team can support it', () => {
    const value = form(); value.games[0] = fixtureGroupCount(fixtureKind(value.games[0], 'group'), 5); value.games[0].game = { ...game, available_teams: 0 }
    const html = renderToStaticMarkup(<CheckoutDetails navigate={noop} step={{ kind: 'game', gameId: game.id }} value={value} update={noop} signedIn busy={false} submit={noop} />)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add another player/)
  })
  it('distinguishes same-venue game regions and remove actions by date and time', () => {
    const value = initialCheckoutForm([game, { ...game, id: '33333333-3333-4333-8333-333333333333', starts_at: '2026-11-06T11:00:00Z', ends_at: '2026-11-06T13:00:00Z' }], session, profile)
    const html = renderToStaticMarkup(<CheckoutDetails navigate={noop} step={{ kind: 'game', gameId: game.id }} value={value} update={noop} signedIn busy={false} submit={noop} />)
    const next = renderToStaticMarkup(<CheckoutDetails navigate={noop} step={{ kind: 'game', gameId: value.games[1].game.id }} value={value} update={noop} signedIn busy={false} submit={noop} />)
    expect(new Set((html + next).match(/aria-label="Registration for QA Court,[^"]+"/g)).size).toBe(2)
    expect(new Set((html + next).match(/aria-label="Remove QA Court,[^"]+from checkout"/g)).size).toBe(2)
  })
  function exactCapacityTeam() {
    const snapshot = { ...game, available_teams: 1, positions: game.positions.map(slot => ({ ...slot, available: slot.position === 'open' || slot.position === 'middle' ? 2 : 1 })) }
    const value = initialCheckoutForm([snapshot], session, { ...profile, position: 'open' })
    value.games[0] = fixtureKind(value.games[0], 'team')
    value.games[0].players = value.games[0].players.map((player, index) => ({ ...player, name: index ? `Named player ${index}` : 'Ana', level: 'intermediate', gender: 'female', birth_date: '1990-01-02', first_timer: false, email: index ? `player-${index}@example.test` : '' }))
    return value
  }
  it('allows the first step of a named role swap at exact team capacity', () => {
    const value = exactCapacityTeam(), entry = value.games[0]
    expect(playerPositionAvailability(entry, 0).setter).toBe(0)
    const html = renderToStaticMarkup(<CheckoutPlayer player={entry.players[0]} index={0} kind="team" organizerName="Ana" game={entry.game} availability={playerPositionAvailability(entry, 0)} update={noop} />)
    expect(html.match(/<option[^>]*value="setter"[^>]*>/)?.[0]).not.toContain('disabled')
  })
  it('blocks intermediate invalid role-swap review while keeping all named profiles intact', () => {
    const value = exactCapacityTeam(), original = value.games[0]
    value.games[0] = changePlayerPosition(original, 0, 'setter')
    expect(checkoutCapacityWarning(value.games[0])).toContain('available slots')
    expect(() => checkoutDraftFrom(value, requestId)).toThrow('A team needs')
    expect(value.games[0].players.slice(1)).toEqual(original.players.slice(1))
  })
  it('completes the exact-capacity named Open/Setter swap without deleting or reentering profiles', () => {
    const value = exactCapacityTeam(), original = value.games[0]
    const setter = original.players.findIndex(player => player.position === 'setter')
    value.games[0] = changePlayerPosition(changePlayerPosition(original, 0, 'setter'), setter, 'open')
    expect(checkoutCapacityWarning(value.games[0])).toBeNull()
    expect(validTeamComposition(value.games[0])).toBe(true)
    expect(checkoutDraftFrom(value, requestId).games[0].players).toHaveLength(6)
    expect(value.games[0].players.map((player, index) => ({ ...player, position: original.players[index].position }))).toEqual(original.players)
  })
})

describe('compact checkout field labels', () => {
  it('keeps field names and required markers inside one inline label group', () => {
    const html = renderToStaticMarkup(<CheckoutDetails navigate={noop} step={{ kind: 'game', gameId: game.id }} value={form()} update={noop} signedIn={false} busy={false} submit={noop} />)
    const contactHtml = renderToStaticMarkup(<CheckoutDetails navigate={noop} step={{ kind: 'contact' }} value={form()} update={noop} signedIn={false} busy={false} submit={noop} />)
    for (const text of ['Name', 'Email', 'Position', 'Skill level', 'Gender', 'Birthday']) expect(html + contactHtml).toContain(`<span class="club-field-label">${text}<span class="club-required"`)
    expect(html).not.toMatch(/<label>[^<]+<span class="club-required"/)
    expect(html).toContain('required=""')
  })
  it('keeps optional email in one label line and first-timer radios inside opted-in details', () => {
    const entry = fixtureKind(form().games[0], 'group')
    entry.players[1].has_details = true
    const html = renderToStaticMarkup(<CheckoutPlayer player={entry.players[1]} index={1} kind="group" organizerName="Ana" game={game} update={noop} />)
    expect(html).toMatch(/<span class="club-field-label">Email <span[^>]*>\(optional\)<\/span><\/span><input/)
    const named = renderToStaticMarkup(<CheckoutPlayer player={form().games[0].players[0]} index={0} kind="group" organizerName="Ana" game={game} update={noop} />)
    expect(named).toContain('type="radio"'); expect(named).toContain('First-timer')
  })
})

describe('unified player list and flat team price', () => {
  function six() {
    let entry = form().games[0]
    while (entry.players.length < 6) entry = addCheckoutPlayer(entry)
    return entry
  }
  it.each([[1, 'individual'], [2, 'group'], [5, 'group'], [6, 'team'], [7, 'team'], [12, 'team']] as const)('derives %s players as %s', (count, kind) => expect(registrationKind(count)).toBe(kind))
  it('adds one player at a time through the group and team boundaries without rewriting earlier players', () => {
    let entry = form().games[0]
    const first = structuredClone(entry.players[0])
    for (let count = 2; count <= 8; count++) {
      const before = entry.players
      entry = addCheckoutPlayer(entry)
      expect(entry.players).toHaveLength(count)
      expect(entry.kind).toBe(registrationKind(count))
      expect(entry.players.slice(0, -1)).toEqual(before)
    }
    expect(entry.players[0]).toEqual(first)
    expect(new Set(entry.players.map(player => player.form_id)).size).toBe(8)
  })
  it('defaults new players to missing core positions while available, without copying organizer details', () => {
    const entry = six()
    expect(validTeamComposition(entry)).toBe(true)
    expect(missingTeamPositions(entry)).toEqual([])
    expect(entry.players[1]).toMatchObject({ has_details: false, name: '', level: null, gender: null, birth_date: '', first_timer: null, email: '', is_registrant: false })
  })
  it('prices six, seven and twelve players as exactly one effective team price', () => {
    let entry = six()
    entry.game = { ...game, team_discount_price: 150000 }
    for (let count = 6; count <= 12; count++) {
      expect(entry.players).toHaveLength(count)
      expect(checkoutFormEstimate(entry)).toBe(150000)
      if (count < 12) entry = addCheckoutPlayer(entry)
    }
  })
  it('keeps the accepted minimum composition valid with repeated-position extras', () => {
    const entry = addCheckoutPlayer(six())
    expect(entry.players).toHaveLength(7)
    expect(entry.players[6].position).toBe('open')
    expect(validTeamComposition(entry)).toBe(true)
  })
  it('reports missing core positions for an incomplete six-player draft without changing identities', () => {
    const entry = six(), original = structuredClone(entry.players)
    const setter = entry.players.findIndex(player => player.position === 'setter')
    const changed = changePlayerPosition(entry, setter, 'open')
    expect(missingTeamPositions(changed)).toEqual(['setter'])
    expect(validTeamComposition(changed)).toBe(false)
    expect(changed.players.filter((_, index) => index !== setter)).toEqual(original.filter((_, index) => index !== setter))
    const value = { ...form(), games: [changed] }
    const html = renderToStaticMarkup(<CheckoutDetails navigate={noop} step={{ kind: 'game', gameId: game.id }} value={value} update={noop} signedIn busy={false} submit={noop} />)
    expect(html).toContain('Still needed for a team: 1 Setter')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue to contact/)
  })
  it('removes an extra without changing the flat price, then reverts six to five to position pricing', () => {
    const seven = addCheckoutPlayer(six()), sixAgain = removeCheckoutPlayer(seven, 6)
    expect(sixAgain.players).toEqual(seven.players.slice(0, 6))
    expect(checkoutFormEstimate(sixAgain)).toBe(165000)
    const five = removeCheckoutPlayer(sixAgain, 5)
    expect(five.kind).toBe('group')
    expect(checkoutFormEstimate(five)).toBe(five.players.reduce((sum, player) => sum + game.positions.find(slot => slot.position === player.position)!.price, 0))
  })
  it('never adds a player beyond actual position capacity', () => {
    const entry = form().games[0]
    entry.game = { ...game, positions: game.positions.map(slot => ({ ...slot, available: slot.position === 'setter' ? 1 : 0 })) }
    expect(additionalPlayerPosition(entry)).toBeNull()
    expect(addCheckoutPlayer(entry)).toBe(entry)
  })
  it('does not add a sixth player when a required core position is unavailable', () => {
    const entry = fixtureGroupCount(fixtureKind(form().games[0], 'group'), 5)
    entry.game = { ...game, positions: game.positions.map(slot => ({ ...slot, available: slot.position === 'middle' ? 1 : 5 })) }
    expect(addCheckoutPlayer(entry)).toBe(entry)
  })
  it('keeps position-only organizer participation separate from organizer contact data', () => {
    const value = initialCheckoutForm([game], session)
    expect(value.games[0].players[0].has_details).toBe(false)
    const draft = checkoutDraftFrom(value, requestId)
    expect(draft.organizer.name).toBe('Ana')
    expect(draft.games[0].players[0]).toMatchObject({ has_details: false, is_registrant: true, name: null })
  })
  it('requires every opted-in field and has no details inputs or first-timer radios while unchecked', () => {
    const player = addCheckoutPlayer(form().games[0]).players[1]
    const unchecked = renderToStaticMarkup(<CheckoutPlayer player={player} index={1} kind="group" organizerName="Ana" game={game} update={noop} />)
    expect(unchecked).toContain('Player details available')
    expect(unchecked).not.toContain('type="date"')
    expect(unchecked).not.toContain('First-timer')
    const checked = renderToStaticMarkup(<CheckoutPlayer player={{ ...player, has_details: true }} index={1} kind="group" organizerName="Ana" game={game} update={noop} />)
    for (const field of ['Name', 'Skill level', 'Gender', 'Birthday']) expect(checked).toContain(`<span class="club-field-label">${field}<span class="club-required"`)
    expect(checked).toContain('type="date" required=""')
    expect(checked).toContain('type="radio" required=""')
  })
  it('renders a fixed position without a position selector for later details-only editing', () => {
    const html = renderToStaticMarkup(<CheckoutPlayer player={form().games[0].players[0]} index={0} kind="individual" organizerName="Ana" game={{ id: game.id, starts_at: game.starts_at, positions: [] }} positionLocked update={noop} />)
    expect(html).toContain('<strong>Setter</strong>')
    expect(html).not.toContain('left after other players')
  })
  it('uses the actual team count in authoritative review and keeps a flat single total', () => {
    const value = { ...form(), games: [addCheckoutPlayer(six())] }
    const reviewed = quote(value)
    const html = renderToStaticMarkup(<CheckoutReview draft={checkoutDraftFrom(value, requestId)} quote={reviewed} busy={false} edit={noop} confirm={noop} />)
    expect(html).toContain('Team · 7 players')
    expect(html).not.toContain('Team of 6')
    expect(reviewed.amount).toBe(165000)
  })
})

describe('organizer participation draft recovery', () => {
  function guest() {
    const value = initialCheckoutForm([game], { ...session, user: null })
    value.organizer = { name: 'Guest organizer', contact: 'guest@example.test', email: '' }
    value.games[0].players[0] = { ...value.games[0].players[0], name: 'Guest organizer', has_details: true, level: 'advanced', gender: 'male', birth_date: '1991-02-03', first_timer: false, email: 'hidden-own-email@example.test' }
    return value
  }
  it('restores a guest-entered own profile after opting out and back in, without replacing it with a saved profile', () => {
    const value = guest(), original = value.games[0].players[0]
    const optedOut = changeOrganizerParticipation(value.games[0], false)
    expect(optedOut.players[0]).toMatchObject({ has_details: false, name: '', birth_date: '', first_timer: null, email: '', is_registrant: false, position: original.position, form_id: original.form_id })
    expect(optedOut.organizer_player_draft?.player).toBe(original)
    const restored = changeOrganizerParticipation(optedOut, true, profile)
    expect(restored.players[0]).toBe(original)
    expect(restored.organizer_player_draft).toBeUndefined()
    expect(restored.organizer_plays).toBe(true)
  })
  it('preserves unchecked details and their hidden personal values across an opt-out round trip', () => {
    const value = guest(); value.games[0].players[0].has_details = false
    const original = value.games[0].players[0]
    const restored = changeOrganizerParticipation(changeOrganizerParticipation(value.games[0], false), true)
    expect(restored.players[0]).toBe(original)
    expect(restored.players[0]).toMatchObject({ has_details: false, name: 'Guest organizer', birth_date: '1991-02-03', first_timer: false, email: 'hidden-own-email@example.test' })
  })
  it('prefers the original empty placeholder even when another empty slot comes first', () => {
    const entry = addCheckoutPlayer(guest().games[0])
    entry.players = [entry.players[1], entry.players[0]]
    const other = entry.players[0], original = entry.players[1]
    const restored = changeOrganizerParticipation(changeOrganizerParticipation(entry, false), true)
    expect(restored.players[0]).toBe(other)
    expect(restored.players[1]).toBe(original)
  })
  it('never overwrites a replacement person and gives an added organizer a distinct local identity', () => {
    const entry = guest().games[0], own = entry.players[0]
    const optedOut = changeOrganizerParticipation(entry, false)
    const replacement = { ...optedOut.players[0], has_details: true, name: 'Bea', level: 'intermediate' as const, gender: 'female' as const, birth_date: '1992-05-06', first_timer: true }
    optedOut.players = [replacement]
    const restored = changeOrganizerParticipation(optedOut, true)
    expect(restored.players[0]).toBe(replacement)
    expect(restored.players[1]).toMatchObject({ ...own, form_id: expect.any(String) })
    expect(restored.players[1].form_id).not.toBe(replacement.form_id)
    expect(restored.kind).toBe('group')
    expect(restored.players.filter(player => player.is_registrant)).toHaveLength(1)
  })
  it('preserves replacement and cached organizer drafts when no extra capacity is available', () => {
    const entry = guest().games[0]
    entry.game = { ...game, positions: game.positions.map(slot => ({ ...slot, available: slot.position === entry.players[0].position ? 1 : 0 })) }
    const optedOut = changeOrganizerParticipation(entry, false)
    optedOut.players[0] = { ...optedOut.players[0], name: 'Bea' }
    expect(changeOrganizerParticipation(optedOut, true)).toBe(optedOut)
    expect(optedOut.organizer_player_draft?.player).toBe(entry.players[0])
  })
  it('does not overwrite a newly checked but otherwise empty replacement draft', () => {
    const optedOut = changeOrganizerParticipation(guest().games[0], false)
    optedOut.players[0] = { ...optedOut.players[0], has_details: true }
    const replacement = optedOut.players[0]
    const restored = changeOrganizerParticipation(optedOut, true)
    expect(restored.players[0]).toBe(replacement)
    expect(restored.players).toHaveLength(2)
  })
  it('keeps every other participant object and position unchanged through the participation round trip', () => {
    let entry = guest().games[0]
    while (entry.players.length < 7) entry = addCheckoutPlayer(entry)
    const others = entry.players.slice(1), own = entry.players[0]
    const optedOut = changeOrganizerParticipation(entry, false)
    expect(optedOut.players).toHaveLength(7)
    expect(checkoutFormEstimate(optedOut)).toBe(checkoutFormEstimate(entry))
    others.forEach((player, index) => expect(optedOut.players[index + 1]).toBe(player))
    const restored = changeOrganizerParticipation(optedOut, true)
    expect(restored.players[0]).toBe(own)
    others.forEach((player, index) => expect(restored.players[index + 1]).toBe(player))
  })
  it('never serializes cached organizer personal data or local identity into review or consent', () => {
    const value = guest(); value.games[0] = changeOrganizerParticipation(value.games[0], false)
    const draft = checkoutDraftFrom(value, requestId), reviewed = quote(value), held = consent(draft, reviewed)
    for (const payload of [draft, held]) {
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain('organizer_player_draft')
      expect(serialized).not.toContain('form_id')
      expect(serialized).not.toContain('1991-02-03')
      expect(serialized).not.toContain('hidden-own-email')
      expect(payload.games[0].players[0]).toMatchObject({ has_details: false, is_registrant: false, name: null })
    }
    const changedCache = structuredClone(value)
    changedCache.games[0].organizer_player_draft!.player.birth_date = '1990-04-05'
    expect(checkoutDraftFrom(changedCache, requestId)).toEqual(draft)
  })
})
