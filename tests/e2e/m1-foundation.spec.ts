import { filterByGameDate } from './helpers/game-filters'
import { test, expect } from '@playwright/test'
import { preflight } from '../../scripts/e2e/target-guard.mjs'
import { OwnedFixture, receiptBytes } from './helpers/owned-fixture'

// Historical compatibility regression: explicit legacy fixture setup, followed
// by real app resume/upload. New checkout creation is tested in M3/M4.
test.describe('M1 isolated real-service foundation', () => {
  let fixture: OwnedFixture

  test.beforeAll(async ({}, info) => {
    info.setTimeout(660_000)
    fixture = new OwnedFixture(preflight(), true)
    await fixture.waitForWriteBudget(4)
    await fixture.prepare()
  })

  test.afterAll(async ({}, testInfo) => {
    if (!fixture) return
    const cleanup = await fixture.dispose()
    await testInfo.attach('owned-fixture-cleanup', { body: JSON.stringify(cleanup, null, 2), contentType: 'application/json' })
  })

  test('guest browser resumes a seeded legacy reservation and private receipt through real REST and Storage', async ({ page, browser }, testInfo) => {
    const target = fixture.target
    await page.goto('/club')
    await expect(page.getByRole('heading', { name: 'Games', exact: true })).toBeVisible()
    await filterByGameDate(page, fixture.gameDate)
    const card = page.getByRole('article').filter({ hasText: fixture.venueName })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('₱300')
    const schedule = await page.request.get(`/api/club?view=schedule&from=${fixture.gameDate}&to=${new Date(Date.parse(fixture.startsAt) + 7 * 86400_000).toISOString().slice(0, 10)}`)
    expect(schedule.status()).toBe(200)
    const games = await schedule.json()
    expect(games.map((game: { id: string }) => game.id)).toContain(fixture.gameId)
    // Explicit historical data setup: public legacy creation is retired.
    const booking = await fixture.seedLegacy(page.context())
    await page.getByRole('button', { name: 'My bookings', exact: true }).click()
    await page.getByRole('article').filter({ hasText: booking.id }).getByRole('button', { name: 'Continue to payment', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const saved = await fixture.rows('bookings', { id: `eq.${booking.id}` })
    expect(saved[0]).toMatchObject({ organization_id: target.organizationId, user_id: null, checkout_id: null, amount: 30000, status: 'holding' })
    expect(saved[0].guest_hash).toMatch(/^[a-f0-9]{64}$/)
    await dialog.locator('input[name="file"]').setInputFiles({ name: 'synthetic-proof.png', mimeType: 'image/png', buffer: receiptBytes })
    const submitted = page.waitForResponse(response => response.url().endsWith('/api/club/upload') && response.request().method() === 'POST')
    await dialog.getByRole('button', { name: 'Reserve', exact: true }).click()
    expect((await submitted).status()).toBe(200)
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: 'My bookings', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'My bookings', exact: true })).toBeVisible()
    await expect(page.getByText('Payment under review', { exact: true })).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: 'My bookings', exact: true }).click()
    await expect(page.getByRole('article').filter({ hasText: booking.id })).toContainText('Reserved')
    const reserved = await fixture.rows('bookings', { id: `eq.${booking.id}` })
    expect(reserved[0].status).toBe('reserved')
    expect(reserved[0].payment_status).toBe('pending')
    const stored = await fixture.storedReceipt(booking.id)
    expect(stored.bytes.equals(receiptBytes)).toBe(true)
    const image = await page.request.get(`/api/club/asset?kind=receipt&id=${booking.id}`)
    expect(image.status()).toBe(200)
    expect(image.headers()['cache-control']).toBe('private, no-store')
    expect((await image.body()).equals(receiptBytes)).toBe(true)
    expect([400, 404]).toContain(await fixture.publicReceiptStatus(stored.path))
    expect([401, 403]).toContain(await fixture.anonymousTableStatus())
    const stranger = await browser.newContext({ baseURL: target.appUrl })
    try {
      const privateImage = await stranger.request.get(`/api/club/asset?kind=receipt&id=${booking.id}`)
      expect(privateImage.status()).toBe(403)
      const mine = await stranger.request.get('/api/club?view=mine')
      expect(mine.status()).toBe(200)
      expect(await mine.json()).toEqual([])
    } finally { await stranger.close() }
    await page.screenshot({ path: testInfo.outputPath('m1-guest-persisted-reservation.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath('m1-guest-persisted-reservation-mobile.png'), fullPage: true })
    await testInfo.attach('m1-baseline-boundary', { body: 'Real local Next → REST/Postgres/private Storage verified. Payment remains pending under the baseline flow. New group/checkout/auto-approval, staff-allowed and Google OAuth are NOT verified.', contentType: 'text/plain' })
  })

  test('genuine local Auth Player owns its booking and is denied staff operations', async ({ browser }, testInfo) => {
    const target = fixture.target
    const context = await browser.newContext({ baseURL: target.appUrl })
    try {
      const userId = await fixture.signIn(context)
      const sessionResponse = await context.request.get('/api/club?view=session')
      expect(sessionResponse.status()).toBe(200)
      const session = await sessionResponse.json()
      expect(session.user.id).toBe(userId)
      expect(session.role).toBe('player')
      expect(session.developer).toBe(false)
      const denied = await context.request.get('/api/club?view=workspace')
      expect(denied.status()).toBe(403)
      const deniedBody = await denied.json()
      const errorEvents = typeof deniedBody.reference === 'string' ? await fixture.rows('developer_events', { organization_id: `eq.${target.organizationId}`, reference_id: `eq.${deniedBody.reference}` }) : []
      await testInfo.attach('m1-error-log-persistence-observation', {
        body: JSON.stringify({
          source: 'Read-only observation after the existing approved workspace-denial request; no extra denial triggered',
          reference: typeof deniedBody.reference === 'string' ? deniedBody.reference : null,
          actor: 'Owned synthetic authenticated Player',
          persistedEventCount: errorEvents.length,
          currentActorMatches: errorEvents.map(event => event.actor_id === userId),
          actions: errorEvents.map(event => event.action === 'read.workspace' ? event.action : 'unexpected-action'),
          codes: errorEvents.map(event => (event.details as { code?: string })?.code === 'ACCESS_DENIED' ? 'ACCESS_DENIED' : 'unexpected-code'),
        }, null, 2), contentType: 'application/json',
      })
      const deniedLogs = await context.request.get('/api/club?view=logs')
      expect(deniedLogs.status()).toBe(403)
      const booking = await fixture.seedLegacy(context, userId)
      const saved = await fixture.rows('bookings', { id: `eq.${booking.id}` })
      expect(saved[0].user_id).toBe(userId)
      expect(saved[0].guest_hash).toBeNull()
      const mine = await context.request.get('/api/club?view=mine')
      expect(mine.status()).toBe(200)
      expect((await mine.json()).map((row: { id: string }) => row.id)).toEqual([booking.id])
      const page = await context.newPage()
      await page.goto('/club')
      await page.getByRole('button', { name: 'My bookings', exact: true }).click()
      await expect(page.getByRole('article').filter({ hasText: booking.id })).toContainText('Continue to payment')
      await expect(page.getByRole('button', { name: 'Manage club', exact: true })).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath('m1-player-own-booking.png'), fullPage: true })
      const logout = await context.request.post('/api/club/auth', { headers: { Origin: target.appUrl } })
      expect(logout.status()).toBe(200)
      const signedOut = await context.request.get('/api/club?view=session')
      expect((await signedOut.json()).user).toBeNull()
      const noOwnership = await context.request.get('/api/club?view=mine')
      expect(await noOwnership.json()).toEqual([])
      await testInfo.attach('m1-authentication-boundary', { body: 'Supported local GoTrue password grant and genuine token validation verified. No Google identity/provider claims fabricated. Google UI/callback and staff-allowed flows remain BLOCKED.', contentType: 'text/plain' })
    } finally { await context.close() }
  })
})
