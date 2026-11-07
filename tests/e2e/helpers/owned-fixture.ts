import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { BrowserContext } from '@playwright/test'
import type { CheckoutDraft, CheckoutGameInput, CheckoutPlayerInput, CheckoutQuote } from '../../../src/features/club/model/types'
import { preflight } from '../../../scripts/e2e/target-guard.mjs'

export type Target = ReturnType<typeof preflight>
export const receiptBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=', 'base64')

type Row = Record<string, unknown>
export interface GamesScenario {
  games: { id: string; venue: string; startsAt: string; endsAt: string }[]
  date: string
  nextWeek: string
  baselineBookingId: string
}
export class OwnedFixture {
  readonly venueId = randomUUID()
  readonly gameId = randomUUID()
  readonly methodId = randomUUID()
  readonly venueName: string
  readonly startsAt = new Date(Date.now() + 3 * 86400_000).toISOString()
  readonly endsAt = new Date(Date.now() + 3 * 86400_000 + 2 * 3600_000).toISOString()
  readonly gameDate: string
  readonly email: string
  private readonly password = randomBytes(24).toString('base64url')
  private createdOrganization = false
  private userId: string | null = null
  private baselineOrganizations: string[] = []
  private baselineSessionRateBucketExists = false
  private extraUsers: string[] = []

  constructor(readonly target: Target, private readonly preserveOperationalLimits = false) {
    this.venueName = `QA Court ${target.runId.slice(0, 8)}`
    this.email = `m1-${target.runId}@example.test`
    this.gameDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.startsAt))
  }

  private async service(path: string, init: RequestInit = {}) {
    // Preflight is mandatory before fixture writes, not just before app startup.
    if (init.method && init.method !== 'GET') preflight()
    const response = await fetch(`${this.target.supabaseUrl}/${path}`, {
      ...init,
      headers: { apikey: this.target.serviceRoleKey, Authorization: `Bearer ${this.target.serviceRoleKey}`, ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
    })
    if (!response.ok) throw new Error(`Owned QA service operation failed (${response.status})`)
    return response
  }

  async rows(table: string, filter: Record<string, string> = {}, select = '*'): Promise<Row[]> {
    const params = new URLSearchParams({ select, ...filter })
    return (await this.service(`rest/v1/${table}?${params}`)).json()
  }

  private async insert(table: string, data: Row | Row[]) {
    await this.service(`rest/v1/${table}`, { method: 'POST', body: JSON.stringify(data) })
  }

  private async remove(table: string, filter: Record<string, string>) {
    await this.service(`rest/v1/${table}?${new URLSearchParams(filter)}`, { method: 'DELETE' })
  }

  async prepare() {
    preflight()
    // Fail before creating an organization if the dedicated stack has not yet
    // received the separately reviewed M3/M4 schema upgrade.
    for (const table of ['checkouts', 'checkout_receipts', 'checkout_receipt_uploads', 'checkout_declined_intents']) await this.rows(table, { limit: '0' })
    // Reject an unupgraded optional-details/edit contract before any fixtures.
    await this.rows('roster_entries', { limit: '0' }, 'id,has_details,version')
    this.baselineOrganizations = (await this.rows('organizations', {}, 'id')).map(row => String(row.id)).sort()
    const sessionBucket = createHmac('sha256', this.target.sessionSecret).update('shared').digest('hex')
    this.baselineSessionRateBucketExists = (await this.rows('request_limits', { bucket: `eq.${sessionBucket}` }, 'bucket')).length > 0
    if (this.baselineOrganizations.includes(this.target.organizationId)) throw new Error('Dedicated fixture organization already exists; refusing to overwrite or clean unknown data')
    try {
      await this.insert('organizations', { id: this.target.organizationId, name: `DVC M1 owned fixture ${this.target.runId}` })
      this.createdOrganization = true
      await this.insert('venues', { id: this.venueId, organization_id: this.target.organizationId, name: this.venueName, city: 'QA only', enabled: true })
      await this.insert('games', { id: this.gameId, organization_id: this.target.organizationId, venue_id: this.venueId, venue: this.venueName, city: 'QA only', starts_at: this.startsAt, ends_at: this.endsAt, status: 'published', team_count: 2, team_price: 165000 })
      await this.insert('game_positions', ['open', 'opposite', 'middle', 'setter'].map(position => ({ game_id: this.gameId, position, capacity: position === 'open' || position === 'middle' ? 4 : 2, price: position === 'setter' ? 25000 : 30000 })))
      await this.insert('payment_methods', { id: this.methodId, organization_id: this.target.organizationId, label: 'QA DEMO — DO NOT PAY', account_name: 'Synthetic QA only', account_number: 'DO NOT PAY', enabled: true })
      const user = await (await this.service('auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: this.email, password: this.password, email_confirm: true, user_metadata: { full_name: 'QA Account Player' } }) })).json()
      if (typeof user.id !== 'string') throw new Error('Local Auth user creation did not return an ID')
      this.userId = user.id
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  async signIn(context: BrowserContext, other = false) {
    preflight()
    let email = this.email, expectedUserId = this.userId
    if (other) {
      email = `other-${randomUUID()}@example.test`
      const user = await (await this.service('auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: this.password, email_confirm: true, user_metadata: { full_name: 'QA Other Player' } }) })).json()
      if (typeof user.id !== 'string') throw new Error('Other owned Auth user was not created')
      this.extraUsers.push(user.id); expectedUserId = user.id
    }
    const response = await fetch(`${this.target.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: this.target.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: this.password }),
    })
    if (!response.ok) throw new Error(`Local supported password authentication failed (${response.status})`)
    const pair = await response.json()
    if (!pair.access_token || !pair.refresh_token || pair.user?.id !== expectedUserId) throw new Error('Local Auth did not return the owned account')
    // This is test-session setup with genuine GoTrue tokens. No product bypass or
    // fake provider identity is introduced; identity() still verifies /user+role.
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(this.target.sessionSecret).digest(), iv)
    const sealed = Buffer.concat([iv, cipher.update(JSON.stringify({ access_token: pair.access_token, refresh_token: pair.refresh_token })), cipher.final(), cipher.getAuthTag()]).toString('base64url')
    await context.addCookies([{ name: 'dvc-auth', value: sealed, url: this.target.appUrl, httpOnly: true, secure: false, sameSite: 'Lax' }])
    return expectedUserId!
  }

  /** Optional M2 data; the default M1 fixture and payment assertions stay intact. */
  async prepareGamesScenario(): Promise<GamesScenario> {
    if (!this.createdOrganization) throw new Error('Prepare the owned organization before M2 data')
    preflight()
    const startsAt = new Date(`${this.gameDate}T18:00:00+08:00`).toISOString()
    const endsAt = new Date(`${this.gameDate}T20:00:00+08:00`).toISOString()
    const nextWeek = new Date(Date.parse(`${this.gameDate}T12:00:00+08:00`) + 7 * 86400_000).toISOString().slice(0, 10)
    await this.service(`rest/v1/games?id=eq.${this.gameId}&organization_id=eq.${this.target.organizationId}`, { method: 'PATCH', body: JSON.stringify({ starts_at: startsAt, ends_at: endsAt, team_discount_price: 150000 }) })
    await this.service(`rest/v1/game_positions?game_id=eq.${this.gameId}&position=eq.open`, { method: 'PATCH', body: JSON.stringify({ discount_price: 27500 }) })
    const games = [{ id: this.gameId, venue: this.venueName, startsAt, endsAt }]
    for (const [suffix, dayOffset, hour] of [['Early', 0, 16], ['Parallel', 0, 18], ['Next week', 7, 18]] as const) {
      const id = randomUUID(), venueId = randomUUID(), venue = `QA ${suffix} ${this.target.runId.slice(0, 8)}`
      const start = new Date(Date.parse(`${this.gameDate}T${hour}:00:00+08:00`) + dayOffset * 86400_000).toISOString()
      const end = new Date(Date.parse(start) + 2 * 3600_000).toISOString()
      await this.insert('venues', { id: venueId, organization_id: this.target.organizationId, name: venue, city: 'QA only', enabled: true })
      await this.insert('games', { id, organization_id: this.target.organizationId, venue_id: venueId, venue, city: 'QA only', starts_at: start, ends_at: end, status: 'published', team_count: 2, team_price: 165000 })
      await this.insert('game_positions', ['open', 'opposite', 'middle', 'setter'].map(position => ({ game_id: id, position, capacity: position === 'open' || position === 'middle' ? 4 : 2, price: position === 'setter' ? 25000 : 30000 })))
      games.push({ id, venue, startsAt: start, endsAt: end })
    }
    const baselineBookingId = randomUUID()
    await this.insert('bookings', { id: baselineBookingId, organization_id: this.target.organizationId, game_id: this.gameId, guest_hash: createHash('sha256').update(`m2-fixture-${this.target.runId}`).digest('hex'), kind: 'individual', captain_name: 'Synthetic PrivateName', contact: 'private-contact@example.test', organizer_email: 'private-organizer@example.test', status: 'reserved', payment_status: 'pending', amount: 27500 })
    await this.insert('roster_entries', { booking_id: baselineBookingId, position: 'open', name: 'Synthetic PrivateName', team: 1, level: 'intermediate', gender: 'female', birth_date: '1995-04-12', first_timer: false, email: 'private-player@example.test' })
    return { games, date: this.gameDate, nextWeek, baselineBookingId }
  }

  registration(name: string) {
    return { game_id: this.gameId, kind: 'individual', position: 'open', organizer_plays: true, name, contact: this.email, organizer_email: this.email, level: 'intermediate', gender: 'prefer_not_to_say', birth_date: '1995-04-12', first_timer: false }
  }

  async bootstrap(context: BrowserContext) {
    return context.request.post('/api/club', { headers: { Origin: this.target.appUrl }, data: { action: 'guest.bootstrap', data: {} } })
  }

  async waitForWriteBudget(required = 15) {
    const started = Date.now()
    const bucket = createHmac('sha256', this.target.sessionSecret).update('shared').digest('hex')
    let announced = false
    while (true) {
      preflight()
      const [limit] = await this.rows('request_limits', { bucket: `eq.${bucket}`, scope: 'eq.write' })
      const reset = limit ? Date.parse(String(limit.window_at)) + 600_000 : 0
      if (!limit || reset <= Date.now() || Number(limit.hits) + required <= 60) return Date.now() - started
      if (!announced) { console.log('QA pacing: waiting for the existing ten-minute application write window; no rate rows reset.'); announced = true }
      await new Promise(resolve => setTimeout(resolve, Math.min(30_000, reset - Date.now() + 30)))
    }
  }

  draft(games: CheckoutGameInput[], name = 'QA Organizer'): CheckoutDraft {
    return { request_id: randomUUID(), organizer: { name, contact: this.email, email: this.email }, games }
  }

  player(position: CheckoutPlayerInput['position'] = 'open', name: string | null = 'QA Organizer', registrant = true): CheckoutPlayerInput {
    return { position, name, is_registrant: registrant, has_details: Boolean(name), ...(name ? { level: 'intermediate', gender: 'prefer_not_to_say', birth_date: '1995-04-12', first_timer: true } : {}) }
  }

  async reviewed(context: BrowserContext, draft: CheckoutDraft): Promise<{ draft: CheckoutDraft; quote: CheckoutQuote }> {
    const response = await context.request.post('/api/club', { headers: { Origin: this.target.appUrl }, data: { action: 'checkout.review', data: draft } })
    if (response.status() !== 200) throw new Error(`Actual checkout review failed (${response.status()})`)
    const { checkout: quote } = await response.json() as { checkout: CheckoutQuote }
    return { quote, draft: { ...draft, games: draft.games.map((game, index) => ({ ...game, expected_amount: quote.games[index].amount, expected_quote: quote.games[index].quote })) } }
  }

  async hold(context: BrowserContext, draft: CheckoutDraft) {
    return context.request.post('/api/club', { headers: { Origin: this.target.appUrl }, data: { action: 'checkout.hold', data: draft } })
  }

  async uploadCheckout(context: BrowserContext, checkoutId: string, bytes = receiptBytes) {
    return context.request.post('/api/club/upload', { headers: { Origin: this.target.appUrl }, multipart: { kind: 'checkout_receipt', checkout: checkoutId, method: this.methodId, file: { name: 'synthetic-proof.png', mimeType: 'image/png', buffer: bytes } } })
  }

  /** New rows are always scoped to this fixture's owned organization/venue. */
  async createBrowseGame(label: string, startsAt: string, endsAt: string, status: 'published' | 'completed' | 'cancelled' | 'draft' = 'published', capacity = 2) {
    if (!this.createdOrganization) throw new Error('Prepare the owned organization first')
    const id = randomUUID(), venue = `QA ${label} ${this.target.runId.slice(0, 8)}`
    await this.insert('games', { id, organization_id: this.target.organizationId, venue_id: this.venueId, venue, city: 'QA only', starts_at: startsAt, ends_at: endsAt, status, team_count: 2, team_price: 165000 })
    await this.insert('game_positions', ['open', 'opposite', 'middle', 'setter'].map(position => ({ game_id: id, position, capacity, price: 30000 })))
    return { id, venue, startsAt, endsAt }
  }

  async patchGame(gameId: string, changes: Row) {
    if (!(await this.rows('games', { id: `eq.${gameId}`, organization_id: `eq.${this.target.organizationId}` })).length) throw new Error('Game is not owned by this fixture')
    await this.service(`rest/v1/games?id=eq.${gameId}&organization_id=eq.${this.target.organizationId}`, { method: 'PATCH', body: JSON.stringify(changes) })
  }

  async patchPosition(gameId: string, position: string, changes: Row) {
    if (!(await this.rows('games', { id: `eq.${gameId}`, organization_id: `eq.${this.target.organizationId}` })).length) throw new Error('Game is not owned by this fixture')
    await this.service(`rest/v1/game_positions?game_id=eq.${gameId}&position=eq.${position}`, { method: 'PATCH', body: JSON.stringify(changes) })
  }

  async expireCheckout(checkoutId: string) {
    if (!(await this.rows('checkouts', { id: `eq.${checkoutId}`, organization_id: `eq.${this.target.organizationId}` })).length) throw new Error('Checkout is not owned by this fixture')
    const expires_at = new Date(Date.now() - 1).toISOString()
    await this.service(`rest/v1/checkouts?id=eq.${checkoutId}&organization_id=eq.${this.target.organizationId}`, { method: 'PATCH', body: JSON.stringify({ expires_at }) })
    await this.service(`rest/v1/bookings?checkout_id=eq.${checkoutId}&organization_id=eq.${this.target.organizationId}`, { method: 'PATCH', body: JSON.stringify({ expires_at }) })
    return expires_at
  }

  async seedLegacy(context: BrowserContext, actorId: string | null = null, status = 'holding', paymentStatus = 'pending', manual = false) {
    preflight()
    let guestHash: string | null = null
    if (!actorId) {
      if ((await this.bootstrap(context)).status() !== 200) throw new Error('Genuine guest bootstrap failed for legacy fixture')
      const token = (await context.cookies()).find(cookie => cookie.name === 'dvc-guest')?.value
      if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Legacy fixture needs a genuine guest owner')
      guestHash = createHash('sha256').update(token).digest('hex')
    }
    const id = randomUUID(), expires_at = new Date(Date.now() + 600_000).toISOString()
    await this.insert('bookings', { id, organization_id: this.target.organizationId, game_id: this.gameId, user_id: actorId, guest_hash: guestHash, kind: 'individual', captain_name: 'QA Legacy Player', contact: this.email, amount: 30000, status, payment_status: paymentStatus, expires_at, checkout_id: null, manual })
    await this.insert('roster_entries', { booking_id: id, position: 'open', name: 'QA Legacy Player', is_registrant: true, level: 'intermediate', gender: 'prefer_not_to_say', age: 31, birth_date: null, first_timer: null })
    return { id, expires_at, amount: 30000 }
  }

  async storedReceipt(bookingId: string) {
    const receipts = await this.rows('receipts', { booking_id: `eq.${bookingId}` })
    if (receipts.length !== 1) throw new Error('Expected exactly one persisted receipt')
    const path = String(receipts[0].path)
    const response = await this.service(`storage/v1/object/authenticated/dvc-private/${path}`)
    return { path, bytes: Buffer.from(await response.arrayBuffer()) }
  }

  async storedCheckoutReceipt(checkoutId: string) {
    if (!(await this.rows('checkouts', { id: `eq.${checkoutId}`, organization_id: `eq.${this.target.organizationId}` })).length) throw new Error('Receipt checkout is not owned')
    const receipts = await this.rows('checkout_receipts', { checkout_id: `eq.${checkoutId}` })
    if (receipts.length !== 1) throw new Error('Expected exactly one checkout receipt')
    const path = String(receipts[0].path)
    const response = await this.service(`storage/v1/object/authenticated/dvc-private/${path}`)
    return { path, bytes: Buffer.from(await response.arrayBuffer()) }
  }

  async objectMissing(path: string) {
    const response = await fetch(`${this.target.supabaseUrl}/storage/v1/object/authenticated/dvc-private/${path}`, { headers: { apikey: this.target.serviceRoleKey, Authorization: `Bearer ${this.target.serviceRoleKey}` } })
    return response.status === 404 || response.status === 400 && String((await response.json().catch(() => ({}))).statusCode) === '404'
  }

  async anonymousTableStatus() {
    return (await fetch(`${this.target.supabaseUrl}/rest/v1/bookings?select=id`, { headers: { apikey: this.target.anonKey, Authorization: `Bearer ${this.target.anonKey}` } })).status
  }

  async publicReceiptStatus(path: string) {
    return (await fetch(`${this.target.supabaseUrl}/storage/v1/object/public/dvc-private/${path}`)).status
  }

  async dispose() {
    preflight()
    if (!this.createdOrganization) return { ownedOrganizationRemoved: true, ownedAuthUsersRemoved: true, baselineOrganizationsPreserved: true }
    const orgFilter = { organization_id: `eq.${this.target.organizationId}` }
    const bookingIds = (await this.rows('bookings', orgFilter, 'id')).map(row => String(row.id))
    const checkoutIds = (await this.rows('checkouts', orgFilter, 'id')).map(row => String(row.id))
    if (checkoutIds.length) {
      const checkoutFilter = { checkout_id: `in.(${checkoutIds.join(',')})` }
      const attempts = await this.rows('checkout_receipt_uploads', checkoutFilter, 'path')
      for (const attempt of attempts) {
        const path = String(attempt.path)
        if (!checkoutIds.some(id => path.startsWith(`checkout-receipts/${id}/`))) throw new Error('Receipt attempt is outside owned checkout paths')
        if (!await this.objectMissing(path)) await this.service(`storage/v1/object/dvc-private/${path}`, { method: 'DELETE' })
        const remaining = await fetch(`${this.target.supabaseUrl}/storage/v1/object/authenticated/dvc-private/${path}`, { headers: { apikey: this.target.serviceRoleKey, Authorization: `Bearer ${this.target.serviceRoleKey}` } })
        if (!(remaining.status === 404 || remaining.status === 400 && String((await remaining.json().catch(() => ({}))).statusCode) === '404')) throw new Error('Owned checkout receipt object cleanup not confirmed')
      }
      await this.remove('checkout_receipts', checkoutFilter)
      await this.remove('checkout_receipt_uploads', checkoutFilter)
      for (const table of ['checkout_receipts', 'checkout_receipt_uploads']) if ((await this.rows(table, checkoutFilter)).length) throw new Error(`Owned ${table} cleanup not proven`)
    }
    if (bookingIds.length) {
      const bookingFilter = { booking_id: `in.(${bookingIds.join(',')})` }
      const receipts = await this.rows('receipts', bookingFilter, 'path')
      for (const receipt of receipts) {
        await this.service(`storage/v1/object/dvc-private/${String(receipt.path)}`, { method: 'DELETE' })
        const remaining = await fetch(`${this.target.supabaseUrl}/storage/v1/object/authenticated/dvc-private/${String(receipt.path)}`, { headers: { apikey: this.target.serviceRoleKey, Authorization: `Bearer ${this.target.serviceRoleKey}` } })
        const missing = remaining.status === 404 || remaining.status === 400 && String((await remaining.json().catch(() => ({}))).statusCode) === '404'
        if (!missing) throw new Error('Owned receipt object cleanup did not return a confirmed not-found response')
      }
      await this.remove('booking_confirmation_outbox', orgFilter)
      await this.remove('receipts', bookingFilter)
      await this.remove('roster_entries', bookingFilter)
    }
    await this.remove('bookings', orgFilter)
    await this.remove('checkout_declined_intents', orgFilter)
    await this.remove('checkouts', orgFilter)
    for (const table of ['player_profiles', 'club_announcements', 'staff_email_whitelist', 'developer_events']) await this.remove(table, orgFilter)
    const gameIds = (await this.rows('games', orgFilter, 'id')).map(row => String(row.id))
    if (gameIds.length) {
      const gameFilter = { game_id: `in.(${gameIds.join(',')})` }
      await this.remove('game_facilitators', gameFilter)
      await this.remove('game_positions', gameFilter)
    }
    await this.remove('games', orgFilter)
    await this.remove('payment_methods', orgFilter)
    await this.remove('venues', orgFilter)
    await this.remove('organizations', { id: `eq.${this.target.organizationId}` })
    // Only this run's unique session-key bucket is owned. The fixed global error
    // rate bucket is operational metadata, so never delete it as fixture cleanup.
    const ownedBucket = createHmac('sha256', this.target.sessionSecret).update('shared').digest('hex')
    if (!this.preserveOperationalLimits && !this.baselineSessionRateBucketExists) await this.remove('request_limits', { bucket: `eq.${ownedBucket}` })
    for (const userId of [...this.extraUsers, ...(this.userId ? [this.userId] : [])]) {
      await this.service(`auth/v1/admin/users/${userId}`, { method: 'DELETE' })
      const remaining = await fetch(`${this.target.supabaseUrl}/auth/v1/admin/users/${userId}`, { headers: { apikey: this.target.serviceRoleKey, Authorization: `Bearer ${this.target.serviceRoleKey}` } })
      if (remaining.status !== 404) throw new Error('Owned Auth user cleanup was not verified')
    }
    const organizations = (await this.rows('organizations', {}, 'id')).map(row => String(row.id)).sort()
    if (JSON.stringify(organizations) !== JSON.stringify(this.baselineOrganizations)) throw new Error('Organization cleanup did not preserve the baseline')
    for (const table of ['bookings', 'checkouts', 'checkout_declined_intents', 'games', 'venues', 'payment_methods', 'player_profiles', 'booking_confirmation_outbox']) if ((await this.rows(table, orgFilter)).length) throw new Error(`Owned ${table} cleanup was not verified`)
    this.createdOrganization = false
    return { ownedOrganizationRemoved: true, ownedAuthUsersRemoved: true, baselineOrganizationsPreserved: true }
  }
}
