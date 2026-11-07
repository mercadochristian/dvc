import { randomUUID } from 'node:crypto'
import { test, expect, individual, confirmedHold, receiptBytes, noNewBookings, type Checkout, type CheckoutGameInput } from './helpers/checkout-harness'
import { withCheckoutFault } from './helpers/checkout-fault'

test.describe('M3/M4 actual registration and atomic checkout services', () => {
  test('REG-02/03/04 kinds, repeated positions, counts and named details use real validation', async ({ owned, scenario, context }) => {
    expect((await owned.bootstrap(context)).status()).toBe(200)
    for (const count of [2, 5]) {
      const players = Array.from({ length: count }, (_, i) => owned.player('open', i === 0 ? 'QA Organizer' : null, i === 0))
      const { quote } = await owned.reviewed(context, owned.draft([{ game_id: owned.gameId, kind: 'group', organizer_plays: true, players }]))
      expect(quote.amount).toBe(count * 27500)
      expect(quote.games[0].players).toHaveLength(count)
    }
    const team: CheckoutGameInput = { game_id: owned.gameId, kind: 'team', organizer_plays: false, players: ['open', 'open', 'opposite', 'middle', 'middle', 'setter'].map(position => owned.player(position as 'open', null, false)) }
    expect((await owned.reviewed(context, owned.draft([team]))).quote.amount).toBe(150000)
    const rejected: unknown[] = [
      { ...team, players: team.players.slice(0, 5) },
      { ...team, players: team.players.map(player => ({ ...player, position: 'open' })) },
      ...[1, 6].map(count => ({ game_id: owned.gameId, kind: 'group', organizer_plays: false, players: Array.from({ length: count }, () => owned.player('open', null, false)) })),
      { ...individual(owned, owned.gameId), organizer_plays: false },
      { ...individual(owned, owned.gameId), players: [{ ...owned.player(), birth_date: null }] },
      ...['level', 'gender', 'first_timer', 'name'].map(field => ({ ...individual(owned, owned.gameId), players: [{ ...owned.player(), [field]: null }] })),
      { ...individual(owned, owned.gameId), players: [{ ...owned.player(), has_details: undefined }] },
      { ...individual(owned, owned.gameId), players: [{ ...owned.player(), age: 31 }] },
      { game_id: owned.gameId, kind: 'group', organizer_plays: false, players: [owned.player('open', null, false), { ...owned.player('open', null, false), level: 'advanced' }] },
    ]
    for (const game of rejected) {
      const response = await context.request.post('/api/club', { headers: { Origin: owned.target.appUrl }, data: { action: 'checkout.review', data: { ...owned.draft([]), games: [game] } } })
      expect([400, 409]).toContain(response.status())
    }
    await noNewBookings(owned, scenario.baselineBookingId)
  })

  test('UNI-01 six-plus teams charge one price while every extra player consumes capacity', async ({ owned, scenario, context }) => {
    await owned.bootstrap(context)
    const core = ['open', 'open', 'opposite', 'middle', 'middle', 'setter'] as const
    const input = (gameId: string, extra: ('open' | 'middle')[]): CheckoutGameInput => ({ game_id: gameId, kind: 'team', organizer_plays: false, players: [...core, ...extra].map(position => owned.player(position, null, false)) })
    const seven = await confirmedHold(owned, context, owned.draft([input(owned.gameId, ['open'])]))
    expect(seven.checkout.amount).toBe(150000)
    const twelve = await confirmedHold(owned, context, owned.draft([input(scenario.games[1].id, ['open', 'open', 'open', 'middle', 'middle', 'middle'])]))
    expect(twelve.checkout.amount).toBe(165000)
    for (const [checkout, count] of [[seven.checkout, 7], [twelve.checkout, 12]] as const) {
      const entries = await owned.rows('roster_entries', { booking_id: `eq.${checkout.bookings[0].id}` })
      expect(entries).toHaveLength(count)
      expect(entries.filter(entry => entry.team !== null)).toHaveLength(6)
      expect(entries.filter(entry => entry.team === null)).toHaveLength(count - 6)
      for (const position of core) expect(entries.filter(entry => entry.team !== null && entry.position === position)).toHaveLength(position === 'open' || position === 'middle' ? 2 : 1)
      expect(entries.every(entry => entry.has_details === false && entry.name === null && entry.birth_date === null && entry.level === null && entry.gender === null && entry.first_timer === null)).toBe(true)
    }
    const schedules = await (await context.request.get(`/api/club?view=schedule&from=${scenario.date}&to=${scenario.nextWeek}`)).json()
    expect(schedules.find((game: { id: string }) => game.id === owned.gameId).positions.find((slot: { position: string }) => slot.position === 'open').available).toBe(4) // Eight capacity, one historical + three new.
    expect((await owned.uploadCheckout(context, seven.checkout.id)).status()).toBe(200)
    expect((await owned.rows('bookings', { id: `eq.${seven.checkout.bookings[0].id}` }))[0]).toMatchObject({ amount: 150000, status: 'reserved', payment_status: 'approved' })
    expect(await owned.rows('roster_entries', { booking_id: `eq.${seven.checkout.bookings[0].id}` })).toHaveLength(7)
  })

  test('UNI-02 extra-position capacity conflict creates no partial multi-game checkout', async ({ owned, scenario, context }) => {
    await owned.bootstrap(context)
    const baselineRoster = await owned.rows('roster_entries', { booking_id: `eq.${scenario.baselineBookingId}`, order: 'id' })
    const players = (['open', 'open', 'opposite', 'middle', 'middle', 'setter', 'open'] as const).map(position => owned.player(position, null, false))
    const reviewed = await owned.reviewed(context, owned.draft([{ game_id: owned.gameId, kind: 'team', organizer_plays: false, players }, individual(owned, scenario.games[1].id)]))
    await owned.patchPosition(owned.gameId, 'open', { capacity: 3 }) // Historical one + core two fit, but the extra Open does not.
    const response = await owned.hold(context, reviewed.draft)
    expect(response.status()).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'CHECKOUT_SELECTION_CONFLICT', conflicts: expect.arrayContaining([expect.objectContaining({ game_id: owned.gameId })]) })
    await noNewBookings(owned, scenario.baselineBookingId)
    expect(await owned.rows('roster_entries', { booking_id: `eq.${scenario.baselineBookingId}`, order: 'id' })).toEqual(baselineRoster)
  })

  test('EDIT-01 authenticated owner edits one profile; denied owners, stale writes and immutable fields preserve history', async ({ owned, scenario, context, browser }) => {
    const userId = await owned.signIn(context)
    const legacy = await owned.seedLegacy(context, userId, 'reserved', 'pending')
    const legacyBefore = await owned.rows('roster_entries', { booking_id: `eq.${legacy.id}` })
    const { checkout } = await confirmedHold(owned, context, owned.draft([
      { game_id: scenario.games[1].id, kind: 'group', organizer_plays: true, players: [owned.player(), owned.player('setter', null, false)] },
      individual(owned, scenario.games[2].id),
    ]))
    expect((await owned.uploadCheckout(context, checkout.id)).status()).toBe(200)
    const booking = checkout.bookings.find(value => value.kind === 'group')!
    const entries = await owned.rows('roster_entries', { booking_id: `eq.${booking.id}`, order: 'id' })
    const target = entries.find(entry => !entry.is_registrant)!, sibling = entries.find(entry => entry.is_registrant)!
    const bookingsBefore = await owned.rows('bookings', { checkout_id: `eq.${checkout.id}`, order: 'id' })
    const checkoutBefore = await owned.rows('checkouts', { id: `eq.${checkout.id}` })
    const receiptsBefore = await owned.rows('checkout_receipts', { checkout_id: `eq.${checkout.id}` })
    const mineEntryOrder = async () => {
      const response = await context.request.get('/api/club?view=mine')
      expect(response.status()).toBe(200)
      const mine = await response.json() as { id: string; entries: { id: string }[] }[]
      const actual = mine.find(row => row.id === booking.id)
      expect(actual).toBeDefined()
      return actual!.entries.map(row => row.id)
    }
    const orderBefore = await mineEntryOrder()
    expect(orderBefore).toEqual(entries.map(entry => entry.id))
    const payload = { booking_id: booking.id, entry_id: target.id, expected_version: target.version, has_details: true, name: 'QA Added Teammate', level: 'advanced', gender: 'female', birth_date: '1998-03-05', first_timer: false, email: 'qa-added@example.test' }
    const update = (actor: typeof context, data: unknown) => actor.request.post('/api/club', { headers: { Origin: owned.target.appUrl }, data: { action: 'booking.player.update', data } })
    const saved = await update(context, payload)
    expect(saved.status()).toBe(200)
    expect(await saved.json()).toMatchObject({ entry: { id: target.id, name: 'QA Added Teammate', has_details: true, version: Number(target.version) + 1, position: target.position, team: target.team, first_timer: false, birth_date: '1998-03-05' } })
    expect(await mineEntryOrder()).toEqual(orderBefore)
    const current = { ...payload, expected_version: Number(target.version) + 1 }
    const other = await browser.newContext({ baseURL: owned.target.appUrl }), guest = await browser.newContext({ baseURL: owned.target.appUrl })
    try {
      await owned.signIn(other, true); await owned.bootstrap(guest)
      for (const actor of [other, guest]) {
        const denied = await update(actor, current)
        expect([400, 403, 404]).toContain(denied.status())
        expect(await denied.json()).not.toHaveProperty('entry')
      }
      expect([400, 409]).toContain((await update(context, payload)).status()) // Original row version is stale.
      for (const invalid of [{ position: 'open' }, { amount: 1, team: 20 }, { birth_date: null }]) expect([400, 409]).toContain((await update(context, { ...current, ...invalid })).status())
      const afterDenied = (await owned.rows('roster_entries', { id: `eq.${target.id}` }))[0]
      expect(afterDenied).toMatchObject({ name: 'QA Added Teammate', version: current.expected_version, position: target.position, team: target.team })
      const cleared = await update(context, { booking_id: booking.id, entry_id: target.id, expected_version: current.expected_version, has_details: false, name: null })
      expect(cleared.status()).toBe(200)
      expect(await mineEntryOrder()).toEqual(orderBefore)
      expect((await owned.rows('roster_entries', { id: `eq.${target.id}` }))[0]).toMatchObject({ has_details: false, name: null, level: null, gender: null, age: null, birth_date: null, first_timer: null, email: null, version: current.expected_version + 1, position: target.position, team: target.team })
      expect(await owned.rows('roster_entries', { id: `eq.${sibling.id}` })).toEqual([sibling])
      expect(await owned.rows('bookings', { checkout_id: `eq.${checkout.id}`, order: 'id' })).toEqual(bookingsBefore)
      expect(await owned.rows('checkouts', { id: `eq.${checkout.id}` })).toEqual(checkoutBefore)
      expect(await owned.rows('checkout_receipts', { checkout_id: `eq.${checkout.id}` })).toEqual(receiptsBefore)
      expect((await owned.storedCheckoutReceipt(checkout.id)).bytes.equals(receiptBytes)).toBe(true)
      expect(await owned.rows('roster_entries', { booking_id: `eq.${legacy.id}` })).toEqual(legacyBefore)
    } finally { await other.close(); await guest.close() }
  })

  test('EDIT-02 guest owner can fill a position-only hold; actual cutoff, closed game and expiry deny later edits', async ({ owned, scenario, context }) => {
    await owned.bootstrap(context)
    const { checkout } = await confirmedHold(owned, context, owned.draft([{ game_id: scenario.games[1].id, kind: 'individual', organizer_plays: false, players: [owned.player('open', null, false)] }]))
    const booking = checkout.bookings[0], row = (await owned.rows('roster_entries', { booking_id: `eq.${booking.id}` }))[0]
    const data = { booking_id: booking.id, entry_id: row.id, expected_version: row.version, has_details: true, name: 'QA Guest Friend', level: 'intermediate', gender: 'prefer_not_to_say', birth_date: '1995-04-12', first_timer: true }
    const update = (changes = {}) => context.request.post('/api/club', { headers: { Origin: owned.target.appUrl }, data: { action: 'booking.player.update', data: { ...data, ...changes } } })
    const before = (await owned.rows('bookings', { id: `eq.${booking.id}` }))[0]
    expect((await update()).status()).toBe(200)
    const saved = (await owned.rows('roster_entries', { id: `eq.${row.id}` }))[0]
    expect(saved).toMatchObject({ name: 'QA Guest Friend', has_details: true, version: Number(row.version) + 1 })
    await owned.patchGame(booking.game_id, { starts_at: new Date(Date.now() + 3_600_000).toISOString(), ends_at: new Date(Date.now() + 10_800_000).toISOString() })
    // This actual HTTP request reaches the server at or just after the one-hour
    // boundary. Exact comparison semantics are also covered by SQL/source proof.
    expect([400, 409]).toContain((await update({ expected_version: saved.version })).status())
    expect(await owned.rows('roster_entries', { id: `eq.${row.id}` })).toEqual([saved])
    await owned.patchGame(booking.game_id, { starts_at: scenario.games[1].startsAt, ends_at: scenario.games[1].endsAt, status: 'cancelled' })
    expect([400, 409]).toContain((await update({ expected_version: saved.version })).status())
    await owned.patchGame(booking.game_id, { status: 'published' })
    const expired = await owned.expireCheckout(checkout.id)
    expect([400, 409]).toContain((await update({ expected_version: saved.version })).status())
    expect(await owned.rows('roster_entries', { id: `eq.${row.id}` })).toEqual([saved])
    const after = (await owned.rows('bookings', { id: `eq.${booking.id}` }))[0]
    expect(after).toMatchObject({ amount: before.amount, kind: before.kind, game_id: before.game_id, status: before.status })
    expect(Date.parse(String(after.expires_at))).toBe(Date.parse(expired))
  })

  test('REG-01/02/04 authenticated own profile persists, Returnee history is private and legacy DOB stays null', async ({ owned, scenario, context, browser }) => {
    const userId = await owned.signIn(context)
    const legacy = await owned.seedLegacy(context, userId, 'reserved', 'pending')
    const rejected = await owned.seedLegacy(context, userId, 'rejected', 'rejected')
    const historicalRejectedPayment = await owned.seedLegacy(context, userId, 'reserved', 'rejected')
    const historicalIds = [legacy.id, rejected.id, historicalRejectedPayment.id]
    const historicalBefore = await owned.rows('bookings', { id: `in.(${historicalIds.join(',')})`, order: 'id' }, 'id,status,payment_status,amount,checkout_id,organizer_email')
    const historical = await context.request.get('/api/club?view=profile')
    expect(await historical.json()).toMatchObject({ name: 'QA Legacy Player', birth_date: null, age: 31, first_timer: false })
    const other = await browser.newContext({ baseURL: owned.target.appUrl })
    const guest = await browser.newContext({ baseURL: owned.target.appUrl })
    try {
      await owned.signIn(other, true)
      for (const actor of [other, guest]) {
        const response = await actor.request.get(`/api/club?view=profile&user=${userId}&email=${encodeURIComponent(owned.email)}`)
        expect(response.status()).toBe(200)
        expect(await response.json()).toBeNull()
      }
      const input = owned.draft([individual(owned, scenario.games[1].id)])
      input.games[0].players[0].birth_date = '1995-04-12'
      const { checkout } = await confirmedHold(owned, context, input)
      const persisted = await owned.rows('player_profiles', { user_id: `eq.${userId}`, organization_id: `eq.${owned.target.organizationId}` })
      expect(persisted).toHaveLength(1)
      expect(persisted[0]).toMatchObject({ name: 'QA Organizer', birth_date: '1995-04-12', first_timer: true })
      expect((await owned.uploadCheckout(context, checkout.id)).status()).toBe(200)
      const profile = await (await context.request.get('/api/club?view=profile')).json()
      expect(profile).toMatchObject({ name: 'QA Organizer', birth_date: '1995-04-12', first_timer: false })
      const profileBeforePositionOnly = await owned.rows('player_profiles', { user_id: `eq.${userId}`, organization_id: `eq.${owned.target.organizationId}` })
      await confirmedHold(owned, context, owned.draft([{ game_id: scenario.games[2].id, kind: 'individual', organizer_plays: true, players: [owned.player('setter', null, true)] }]))
      expect(await owned.rows('player_profiles', { user_id: `eq.${userId}`, organization_id: `eq.${owned.target.organizationId}` })).toEqual(profileBeforePositionOnly)
      expect(await owned.rows('roster_entries', { booking_id: `eq.${legacy.id}` })).toEqual(expect.arrayContaining([expect.objectContaining({ birth_date: null, age: 31 })]))
      expect((await owned.rows('bookings', { id: `eq.${legacy.id}` }))[0]).toMatchObject({ status: 'reserved', payment_status: 'pending', amount: 30000, checkout_id: null })
      expect(await owned.rows('bookings', { id: `in.(${historicalIds.join(',')})`, order: 'id' }, 'id,status,payment_status,amount,checkout_id,organizer_email')).toEqual(historicalBefore)
      const entries = await owned.rows('roster_entries', { booking_id: `eq.${checkout.bookings[0].id}` })
      const date = scenario.games[1].startsAt.slice(0, 10), year = Number(date.slice(0, 4))
      expect(entries[0].age).toBe(year - 1995 - (date.slice(5) < '04-12' ? 1 : 0))
      expect(entries[0].first_timer).toBe(true) // Explicit override is preserved.
    } finally { await other.close(); await guest.close() }
  })

  test('CHK-01/04 mixed games share exact discounted total, one expiry and one private automatically approved receipt', async ({ owned, scenario, context, browser }) => {
    await owned.bootstrap(context)
    const games: CheckoutGameInput[] = [
      { game_id: owned.gameId, kind: 'group', organizer_plays: false, players: [{ ...owned.player('open', 'QA Friend', false), email: 'qa-friend@example.test' }, owned.player('open', null, false)] },
      { ...individual(owned, scenario.games[1].id), players: [owned.player('setter')] },
      { game_id: scenario.games[2].id, kind: 'team', organizer_plays: false, players: ['open', 'open', 'opposite', 'middle', 'middle', 'setter'].map(p => owned.player(p as 'open', null, false)) },
    ]
    const reviewed = await owned.reviewed(context, owned.draft(games))
    expect(reviewed.quote.games.map(game => game.amount)).toEqual([55000, 25000, 165000])
    expect(reviewed.quote.amount).toBe(245000)
    await noNewBookings(owned, scenario.baselineBookingId)
    const response = await owned.hold(context, reviewed.draft)
    expect(response.status()).toBe(200)
    const checkout = (await response.json()).checkout as Checkout
    expect(checkout.amount).toBe(245000)
    expect(checkout.bookings).toHaveLength(3)
    expect(new Set(checkout.bookings.map(b => b.expires_at))).toEqual(new Set([checkout.expires_at]))
    // Both timestamps come from PostgreSQL; the host and container clocks can differ.
    const createdAt = Date.parse(checkout.created_at), expiresAt = Date.parse(checkout.expires_at)
    expect(Number.isFinite(createdAt)).toBe(true)
    expect(Number.isFinite(expiresAt)).toBe(true)
    expect(expiresAt - createdAt).toBeGreaterThanOrEqual(599000)
    expect(expiresAt - createdAt).toBeLessThanOrEqual(600000)
    const [persistedCheckout] = await owned.rows('checkouts', { id: `eq.${checkout.id}` })
    expect(persistedCheckout).toMatchObject({ status: 'holding', created_at: checkout.created_at, expires_at: checkout.expires_at })
    expect(checkout.bookings.map(b => b.entries?.length).sort()).toEqual([1, 2, 6])
    const groupBooking = checkout.bookings.find(booking => booking.kind === 'group')!
    expect(groupBooking.organizer_plays).toBe(false)
    expect(groupBooking.entries?.filter(player => player.is_registrant)).toHaveLength(0)
    expect(groupBooking.entries?.filter(player => player.name === null)).toHaveLength(1)
    expect(groupBooking.entries?.find(player => player.name === 'QA Friend')).toMatchObject({ level: 'intermediate', gender: 'prefer_not_to_say', birth_date: '1995-04-12', first_timer: true, email: 'qa-friend@example.test' })
    const teamBooking = checkout.bookings.find(booking => booking.kind === 'team')!
    expect(teamBooking.entries?.map(player => player.position).sort()).toEqual(['middle', 'middle', 'open', 'open', 'opposite', 'setter'])
    const uploads = await Promise.all([owned.uploadCheckout(context, checkout.id), owned.uploadCheckout(context, checkout.id)])
    for (const upload of uploads) { expect(upload.status()).toBe(200); expect((await upload.json()).checkout).toMatchObject({ id: checkout.id, status: 'reserved', payment_status: 'approved', expires_at: checkout.expires_at }) }
    const bookings = await owned.rows('bookings', { checkout_id: `eq.${checkout.id}` })
    expect(bookings).toHaveLength(3)
    for (const booking of bookings) expect(booking).toMatchObject({ status: 'reserved', payment_status: 'approved', expires_at: checkout.expires_at })
    expect(await owned.rows('checkout_receipts', { checkout_id: `eq.${checkout.id}` })).toHaveLength(1)
    expect(await owned.rows('receipts', { booking_id: `in.(${checkout.bookings.map(b => b.id).join(',')})` })).toHaveLength(0)
    const stored = await owned.storedCheckoutReceipt(checkout.id)
    expect(stored.bytes.equals(receiptBytes)).toBe(true)
    const asset = await context.request.get(`/api/club/asset?kind=checkout_receipt&id=${checkout.id}`)
    expect(asset.status()).toBe(200)
    expect(asset.headers()['cache-control']).toBe('private, no-store')
    expect((await asset.body()).equals(receiptBytes)).toBe(true)
    expect([400, 404]).toContain(await owned.publicReceiptStatus(stored.path))
    const stranger = await browser.newContext({ baseURL: owned.target.appUrl })
    try {
      expect((await stranger.request.get(`/api/club?view=checkout&id=${checkout.id}`)).status()).toBe(404)
      expect((await stranger.request.get(`/api/club/asset?kind=checkout_receipt&id=${checkout.id}`)).status()).toBe(403)
      expect((await owned.uploadCheckout(stranger, checkout.id)).status()).not.toBe(200)
    } finally { await stranger.close() }
    expect((await owned.rows('bookings', { id: `eq.${scenario.baselineBookingId}` }))[0]).toMatchObject({ payment_status: 'pending', amount: 27500 })
  })

  test('CHK-02 durable declined intent creates no partial holds even after capacity recovers', async ({ owned, scenario, context }) => {
    await owned.bootstrap(context)
    const reviewed = await owned.reviewed(context, owned.draft([individual(owned, owned.gameId), individual(owned, scenario.games[1].id)]))
    await owned.patchPosition(owned.gameId, 'open', { capacity: 1 })
    const failed = await owned.hold(context, reviewed.draft)
    expect(failed.status()).toBe(409)
    expect(await failed.json()).toMatchObject({ code: 'CHECKOUT_SELECTION_CONFLICT', conflicts: expect.arrayContaining([expect.objectContaining({ game_id: owned.gameId })]) })
    await noNewBookings(owned, scenario.baselineBookingId)
    expect(await owned.rows('checkout_declined_intents', { organization_id: `eq.${owned.target.organizationId}`, request_id: `eq.${reviewed.draft.request_id}` })).toHaveLength(1)
    await owned.patchPosition(owned.gameId, 'open', { capacity: 8 })
    expect((await owned.hold(context, reviewed.draft)).status()).toBe(409)
    await noNewBookings(owned, scenario.baselineBookingId)
    const corrected = { ...reviewed.draft, request_id: randomUUID() }
    expect((await owned.hold(context, corrected)).status()).toBe(200)
  })

  test('CHK-02 actual simultaneous owners never oversell the final slot', async ({ owned, scenario, context, browser }) => {
    await owned.patchPosition(owned.gameId, 'open', { capacity: 2 }) // One already reserved.
    const other = await browser.newContext({ baseURL: owned.target.appUrl })
    try {
      await Promise.all([owned.bootstrap(context), owned.bootstrap(other)])
      const drafts = await Promise.all([context, other].map(actor => owned.reviewed(actor, owned.draft([individual(owned, owned.gameId)]))))
      const responses = await Promise.all([owned.hold(context, drafts[0].draft), owned.hold(other, drafts[1].draft)])
      expect(responses.map(r => r.status()).sort()).toEqual([200, 409])
      const bookings = await owned.rows('bookings', { game_id: `eq.${owned.gameId}` })
      expect(bookings).toHaveLength(2)
      expect(bookings.filter(b => b.status === 'holding')).toHaveLength(1)
      expect(bookings.filter(b => b.id === scenario.baselineBookingId)).toHaveLength(1)
    } finally { await other.close() }
  })

  test('CHK-03 positive replay, payload mismatch and expiry never create a renewed checkout', async ({ owned, scenario, context }) => {
    await owned.bootstrap(context)
    const reviewed = await owned.reviewed(context, owned.draft([individual(owned, scenario.games[1].id)]))
    const [a, b] = await Promise.all([owned.hold(context, reviewed.draft), owned.hold(context, reviewed.draft)])
    expect(a.status()).toBe(200); expect(b.status()).toBe(200)
    const checkout = (await a.json()).checkout as Checkout
    expect((await b.json()).checkout).toMatchObject({ id: checkout.id, expires_at: checkout.expires_at })
    const mismatch = await owned.hold(context, { ...reviewed.draft, organizer: { ...reviewed.draft.organizer, contact: 'different@example.test' } })
    expect(mismatch.status()).toBe(409)
    expect(await mismatch.json()).toMatchObject({ code: 'CHECKOUT_INTENT_MISMATCH', checkout: { id: checkout.id } })
    const expires = await owned.expireCheckout(checkout.id)
    const upload = await owned.uploadCheckout(context, checkout.id)
    expect(upload.status()).toBe(409)
    const replay = await owned.hold(context, reviewed.draft)
    expect(replay.status()).toBe(200)
    const replayed = (await replay.json()).checkout as Checkout
    expect(replayed).toMatchObject({ id: checkout.id, status: 'expired' })
    expect(Number.isFinite(Date.parse(replayed.expires_at))).toBe(true)
    expect(Number.isFinite(Date.parse(expires))).toBe(true)
    expect(Date.parse(replayed.expires_at)).toBe(Date.parse(expires))
    expect(Date.parse(replayed.expires_at)).toBeLessThan(Date.now())
    expect(await owned.rows('checkouts', { organization_id: `eq.${owned.target.organizationId}` })).toHaveLength(1)
    expect(await owned.rows('checkout_receipts', { checkout_id: `eq.${checkout.id}` })).toHaveLength(0)
    expect(await owned.rows('checkout_receipt_uploads', { checkout_id: `eq.${checkout.id}` })).toHaveLength(0)
    const fresh = await confirmedHold(owned, context, owned.draft([individual(owned, scenario.games[1].id)]))
    expect(fresh.checkout.id).not.toBe(checkout.id)
  })

  test('CHK-06 review consent catches compensated price and schedule changes; accepted amounts stay immutable', async ({ owned, scenario, context }) => {
    await owned.bootstrap(context)
    const game: CheckoutGameInput = { game_id: owned.gameId, kind: 'group', organizer_plays: true, players: [owned.player(), owned.player('setter', null, false)] }
    const reviewed = await owned.reviewed(context, owned.draft([game]))
    await owned.patchPosition(owned.gameId, 'open', { discount_price: 27000 })
    await owned.patchPosition(owned.gameId, 'setter', { price: 25500 }) // Same sum, different consent.
    const changed = await owned.hold(context, reviewed.draft)
    expect(changed.status()).toBe(409)
    expect(await changed.json()).toMatchObject({ conflicts: expect.arrayContaining([expect.objectContaining({ code: 'PRICE_CHANGED' })]) })
    await noNewBookings(owned, scenario.baselineBookingId)
    const updated = await owned.reviewed(context, owned.draft([game]))
    await owned.patchGame(owned.gameId, { starts_at: new Date(Date.parse(scenario.games[0].startsAt) + 60000).toISOString() })
    const moved = await owned.hold(context, updated.draft)
    expect(moved.status()).toBe(409)
    expect(await moved.json()).toMatchObject({ conflicts: expect.arrayContaining([expect.objectContaining({ code: 'SCHEDULE_CHANGED' })]) })
    const accepted = await confirmedHold(owned, context, owned.draft([game]))
    const before = await owned.rows('bookings', { checkout_id: `eq.${accepted.checkout.id}` }, 'amount,quote_snapshot')
    await owned.patchPosition(owned.gameId, 'open', { discount_price: 26000 })
    await owned.patchGame(owned.gameId, { team_discount_price: 140000, venue: 'QA Changed venue' })
    expect(await owned.rows('bookings', { checkout_id: `eq.${accepted.checkout.id}` }, 'amount,quote_snapshot')).toEqual(before)
    expect((await owned.uploadCheckout(context, accepted.checkout.id)).status()).toBe(200)
    expect((await owned.rows('checkouts', { id: `eq.${accepted.checkout.id}` }))[0].amount).toBe(accepted.checkout.amount)
  })

  for (const fault of ['database', 'storage'] as const) test(`CHK-05 real ${fault} failure rolls back approval and retry preserves the original hold`, async ({ owned, scenario, context }) => {
    await owned.bootstrap(context)
    const { checkout } = await confirmedHold(owned, context, owned.draft([individual(owned, scenario.games[1].id), individual(owned, scenario.games[2].id)]))
    await withCheckoutFault(owned, checkout.id, fault, async () => {
      const upload = await owned.uploadCheckout(context, checkout.id)
      expect([409, 500, 502]).toContain(upload.status())
      expect((await owned.rows('checkouts', { id: `eq.${checkout.id}` }))[0]).toMatchObject({ status: 'holding', payment_status: 'pending', expires_at: checkout.expires_at })
      for (const booking of await owned.rows('bookings', { checkout_id: `eq.${checkout.id}` })) expect(booking).toMatchObject({ status: 'holding', payment_status: 'pending' })
      expect(await owned.rows('checkout_receipts', { checkout_id: `eq.${checkout.id}` })).toHaveLength(0)
      const attempts = await owned.rows('checkout_receipt_uploads', { checkout_id: `eq.${checkout.id}` })
      expect(attempts).toHaveLength(1)
      expect(attempts[0].state).toBe('discarded')
      expect(await owned.objectMissing(String(attempts[0].path))).toBe(true)
    })
    const retried = await owned.uploadCheckout(context, checkout.id)
    expect(retried.status()).toBe(200)
    expect((await retried.json()).checkout).toMatchObject({ id: checkout.id, status: 'reserved', payment_status: 'approved', expires_at: checkout.expires_at })
    expect((await owned.storedCheckoutReceipt(checkout.id)).bytes.equals(receiptBytes)).toBe(true)
  })
})
