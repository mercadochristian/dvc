import { filterByGameDate } from './helpers/game-filters'
import { test, expect, continueRegistration, activatePlayer, discardRegistration, registerGameSelection, openRegistration, fillOrganizer, fillPlayer, playerField, noNewBookings, individual, confirmedHold, receiptBytes, type Checkout } from './helpers/checkout-harness'

test.describe('M3/M4 real browser registration and guest ownership', () => {
  test('REG-01/CHK-02 cookie-less review and hold deny without minting competing guest owners', async ({ owned, scenario, context, browser }) => {
    await owned.bootstrap(context)
    const reviewed = await owned.reviewed(context, owned.draft([individual(owned, owned.gameId)]))
    const empty = await browser.newContext({ baseURL: owned.target.appUrl })
    try {
      for (const action of ['checkout.review', 'checkout.hold']) {
        const response = await empty.request.post('/api/club', { headers: { Origin: owned.target.appUrl }, data: { action, data: reviewed.draft } })
        expect(response.status()).toBe(409)
        expect(Boolean(response.headers()['set-cookie'])).toBe(false)
        expect(await response.json()).toMatchObject({ code: action === 'checkout.review' ? 'CHECKOUT_SESSION_REQUIRED' : 'CHECKOUT_REVIEW_REQUIRED' })
      }
      const retired = await empty.request.post('/api/club', { headers: { Origin: owned.target.appUrl }, data: { action: 'booking.hold', data: owned.registration('QA Legacy Attempt') } })
      expect(retired.status()).toBe(409)
      expect(await retired.json()).toMatchObject({ code: 'LEGACY_REGISTRATION_RETIRED' })
      expect(Boolean(retired.headers()['set-cookie'])).toBe(false)
      expect((await empty.cookies()).some(cookie => cookie.name === 'dvc-guest')).toBe(false)
      await noNewBookings(owned, scenario.baselineBookingId)
    } finally { await empty.close() }
  })

  test('REG-01/REG-UX native two-page Web Locks retain delayed bootstrap through dismiss and reopen', async ({ owned, scenario, context, page }) => {
    expect((await context.cookies()).some(cookie => cookie.name === 'dvc-guest')).toBe(false)
    const second = await context.newPage()
    const bootstrapCookies: Promise<boolean>[] = []
    const cookieWriters: Promise<{ action: string; wrote: boolean }>[] = []
    context.on('response', response => {
      if (response.request().method() !== 'POST' || !response.url().endsWith('/api/club')) return
      const action = response.request().postDataJSON()?.action
      const wrote = response.headerValue('set-cookie').then(header => Boolean(header?.includes('dvc-guest=')))
      cookieWriters.push(wrote.then(value => ({ action, wrote: value })))
      if (action === 'guest.bootstrap') bootstrapCookies.push(wrote)
    })
    let release!: () => void, reached!: () => void, bootstrapRequests = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    const intercepted = new Promise<void>(resolve => { reached = resolve })
    await context.route('**/api/club', async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'guest.bootstrap') {
        bootstrapRequests += 1
        if (bootstrapRequests === 1) { reached(); await gate }
      }
      await route.continue()
    })
    try {
      await openRegistration(page, owned)
      await fillOrganizer(page); await fillPlayer(playerField(page))
      await continueRegistration(page, 'Review registration')
      await intercepted
      await discardRegistration(page, 'close')
      await registerGameSelection(page, page.getByRole('article').filter({ has: page.getByRole('heading', { name: owned.venueName, exact: true }) }))
      await fillOrganizer(page); await fillPlayer(playerField(page))
      await openRegistration(second, owned, scenario.games[1].venue)
      await fillOrganizer(second); await fillPlayer(playerField(second))
      await continueRegistration(page, 'Review registration')
      await continueRegistration(second, 'Review registration')
      await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending?.filter(lock => lock.name === 'dvc-guest-owner-v1').length || 0)).toBe(2)
      // Deliberately exceed the ordinary 20s mutation timeout. Bootstrap must
      // retain its real lock/fetch until the actual cookie response settles.
      await new Promise(resolve => setTimeout(resolve, 21_000))
      expect(bootstrapRequests).toBe(1)
      expect((await context.cookies()).some(cookie => cookie.name === 'dvc-guest')).toBe(false)
      release()
      for (const tab of [page, second]) await expect(tab.getByRole('dialog').getByRole('heading', { name: 'Review your registration', exact: true })).toBeVisible()
      expect(bootstrapRequests).toBe(3)
      expect((await Promise.all(bootstrapCookies)).filter(Boolean)).toHaveLength(1)
      const cookie = (await context.cookies()).find(cookie => cookie.name === 'dvc-guest')
      expect(Boolean(cookie?.httpOnly)).toBe(true)
      await noNewBookings(owned, scenario.baselineBookingId)
      await Promise.all([page, second].map(tab => tab.getByRole('dialog').getByRole('button', { name: 'Register', exact: true }).click()))
      for (const tab of [page, second]) await expect(tab.getByRole('dialog').getByRole('heading', { name: 'Payment', exact: true })).toBeVisible()
      const checkouts = await owned.rows('checkouts', { organization_id: `eq.${owned.target.organizationId}` })
      expect(checkouts).toHaveLength(2)
      expect(new Set(checkouts.map(checkout => checkout.guest_hash)).size === 1).toBe(true)
      expect(checkouts.every(checkout => checkout.user_id === null)).toBe(true)
      expect((await Promise.all(cookieWriters)).filter(response => response.wrote).map(response => response.action)).toEqual(['guest.bootstrap'])
    } finally { release(); await context.unroute('**/api/club'); await second.close() }
  })

  test('REG-01/REG-UX missing Web Locks fails closed without bootstrap or quote fallback', async ({ owned, scenario, context, page }) => {
    await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }))
    const actions: string[] = []
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/club')) actions.push(request.postDataJSON()?.action) })
    await openRegistration(page, owned)
    await fillOrganizer(page); await fillPlayer(playerField(page))
    await continueRegistration(page, 'Review registration')
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Update your browser or sign in')
    expect(actions).toEqual([])
    expect((await context.cookies()).some(cookie => cookie.name === 'dvc-guest')).toBe(false)
    await noNewBookings(owned, scenario.baselineBookingId)
  })

  test('REG-01/02 own profile autofills on reload, teammate stays unknown and authenticated review skips bootstrap', async ({ owned, scenario, context, page }) => {
    await owned.signIn(context)
    const prior = await confirmedHold(owned, context, owned.draft([individual(owned, scenario.games[1].id)]))
    expect((await owned.uploadCheckout(context, prior.checkout.id)).status()).toBe(200)
    await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }))
    const actions: string[] = []
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/club')) actions.push(request.postDataJSON()?.action) })
    await openRegistration(page, owned)
    await expect(playerField(page).getByLabel(/^Name/)).toHaveValue('QA Organizer')
    await expect(playerField(page).getByLabel(/^Birthday/)).toHaveValue('1995-04-12')
    await expect(playerField(page).getByRole('radio', { name: 'Returnee', exact: true })).toBeChecked()
    await continueRegistration(page, 'Add another player')
    await playerField(page, 2).getByRole('checkbox', { name: 'Player details available', exact: true }).check()
    await playerField(page, 2).getByLabel(/^Name/).fill('QA Teammate')
    await expect(playerField(page, 2).getByLabel(/^Birthday/)).toHaveValue('')
    await expect(playerField(page, 2).getByRole('radio', { name: 'Returnee', exact: true })).not.toBeChecked()
    await expect(playerField(page, 2).getByRole('radio', { name: 'First-timer', exact: true })).not.toBeChecked()
    await fillPlayer(playerField(page, 2))
    await activatePlayer(page)
    await playerField(page).getByRole('radio', { name: 'First-timer', exact: true }).check()
    await continueRegistration(page, 'Review registration')
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Review your registration', exact: true })).toBeVisible()
    expect(actions).toEqual(['checkout.review'])
    expect((await context.cookies()).some(cookie => cookie.name === 'dvc-guest')).toBe(false)
    await discardRegistration(page)
    await page.reload()
    await filterByGameDate(page, owned.gameDate)
    await registerGameSelection(page, page.getByRole('article').filter({ hasText: owned.venueName }))
    await expect(playerField(page).getByLabel(/^Birthday/)).toHaveValue('1995-04-12')
  })

  test('REG-03/04 CHK-01/03 REG-UX mixed forms review without holds, edit/remove and resume one unchanged expiry', async ({ owned, scenario, page }, info) => {
    await page.goto('/club'); await filterByGameDate(page, scenario.date)
    for (const game of scenario.games.slice(0, 3)) await page.getByRole('article').filter({ hasText: game.venue }).getByRole('button', { name: /^Select / }).click()
    await page.getByRole('region', { name: 'Game selection' }).getByRole('button', { name: 'Continue to registration', exact: true }).click()
    await fillOrganizer(page)
    const regions = scenario.games.slice(0, 3).map(game => page.getByRole('dialog').getByRole('region', { name: new RegExp(`^Registration for ${game.venue},`) }))
    await fillPlayer(playerField(page))
    for (let i = 1; i < 5; i++) await continueRegistration(page, 'Add another player')
    for (let i = 1; i <= 5; i++) { await activatePlayer(page, i, regions[0]); await regions[0].getByRole('group', { name: `Player ${i} details`, exact: true }).getByLabel(/^Position/).selectOption('open') }
    await activatePlayer(page, 1, regions[0])
    await fillPlayer(regions[0].getByRole('group', { name: 'Player 1 details', exact: true }))
    await regions[0].getByRole('group', { name: 'Player 1 details', exact: true }).getByRole('radio', { name: 'Returnee', exact: true }).check()
    await expect(regions[0]).toContainText('5 players · Group registration')
    await continueRegistration(page, 'Next game')
    await regions[1].getByRole('checkbox', { name: 'I am playing in this game', exact: true }).uncheck()
    const friend = regions[1].getByRole('group', { name: 'Player 1 details', exact: true })
    await friend.getByRole('checkbox', { name: 'Player details available', exact: true }).check()
    await friend.getByLabel(/^Name/).fill('QA Friend'); await fillPlayer(friend)
    await expect(friend.getByLabel(/^Birthday/)).toHaveAttribute('required', '')
    await expect(friend.locator('label').filter({ hasText: 'Birthday' }).locator('.club-required')).toHaveText('*')
    await continueRegistration(page, 'Next game')
    await regions[2].getByRole('checkbox', { name: 'I am playing in this game', exact: true }).uncheck()
    for (let i = 1; i < 6; i++) await continueRegistration(page, 'Add another player')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('m3-named-placeholder-forms-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1280, height: 900 })
    await continueRegistration(page, 'Review registration')
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Review your registration', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText('₱3,325')
    await expect(page.locator('[tabindex="-1"][aria-label="Registration review"]')).toBeFocused()
    await noNewBookings(owned, scenario.baselineBookingId)
    await page.screenshot({ path: info.outputPath('m4-mixed-review-desktop.png'), fullPage: true })
    await page.getByRole('dialog').getByRole('button', { name: 'Edit details', exact: true }).click()
    await regions[2].getByRole('button', { name: /^Remove .* from checkout$/ }).click()
    await continueRegistration(page, 'Review registration')
    await expect(page.getByRole('dialog')).toContainText('₱1,675')
    await noNewBookings(owned, scenario.baselineBookingId)
    const held = page.waitForResponse(response => response.url().endsWith('/api/club') && response.request().postDataJSON()?.action === 'checkout.hold')
    await page.getByRole('dialog').getByRole('button', { name: 'Register', exact: true }).click()
    const holdResponse = await held; expect(holdResponse.status()).toBe(200)
    const checkout = (await holdResponse.json()).checkout as Checkout
    expect(checkout.amount).toBe(167500); expect(checkout.bookings).toHaveLength(2)
    expect(checkout.bookings.find(booking => booking.kind === 'group')?.entries?.find(player => player.is_registrant)?.first_timer).toBe(false)
    await expect(page.getByRole('dialog').getByRole('timer')).toContainText('original ten-minute expiry')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'My bookings', exact: true }).click()
    await page.reload(); await page.getByRole('button', { name: 'My bookings', exact: true }).click()
    await page.getByRole('article').filter({ hasText: checkout.id }).getByRole('button', { name: 'Continue to payment', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('₱1,675')
    expect((await owned.rows('checkouts', { id: `eq.${checkout.id}` }))[0].expires_at).toBe(checkout.expires_at)
    await expect(page.getByRole('dialog')).toContainText('Synthetic QA only')
    await expect(page.getByRole('dialog')).toContainText('DO NOT PAY')
    for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await expect(page.getByRole('dialog').getByRole('heading', { name: 'Payment', exact: true })).toBeVisible()
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Submit receipt and reserve', exact: true })).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`m4-payment-synthetic-method-${viewport.name}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('dialog').locator('input[name="file"]').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic invalid image') })
    await page.getByRole('dialog').getByRole('button', { name: 'Submit receipt and reserve', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Submit receipt and reserve', exact: true })).toBeEnabled()
    await page.getByRole('dialog').locator('input[name="file"]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: receiptBytes })
    await page.getByRole('dialog').getByRole('button', { name: 'Submit receipt and reserve', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('article').filter({ hasText: checkout.id })).toContainText('Payment approved')
    expect((await owned.storedCheckoutReceipt(checkout.id)).bytes.equals(receiptBytes)).toBe(true)
    for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      const reserved = page.getByRole('article').filter({ hasText: checkout.id })
      await reserved.scrollIntoViewIfNeeded()
      await expect(reserved).toContainText('Reserved')
      await expect(reserved).toContainText('Payment approved')
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`m4-reserved-confirmation-my-bookings-${viewport.name}.png`), fullPage: true })
    }
  })

  test('CHK-05 real committed upload with dropped browser response reconciles without losing its receipt', async ({ owned, scenario, context, page }) => {
    await owned.bootstrap(context)
    const { checkout } = await confirmedHold(owned, context, owned.draft([individual(owned, scenario.games[1].id)]))
    await page.goto('/club'); await page.getByRole('button', { name: 'My bookings', exact: true }).click()
    await page.getByRole('article').filter({ hasText: checkout.id }).getByRole('button', { name: 'Continue to payment', exact: true }).click()
    let committed = false
    await page.route('**/api/club/upload', async route => {
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      const saved = await actual.json()
      expect(saved.checkout).toMatchObject({ id: checkout.id, status: 'reserved', payment_status: 'approved' })
      expect((await owned.storedCheckoutReceipt(checkout.id)).bytes.equals(receiptBytes)).toBe(true)
      committed = true
      await route.abort('failed') // Only the transport response is lost.
    })
    await page.getByRole('dialog').locator('input[name="file"]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: receiptBytes })
    await page.getByRole('dialog').getByRole('button', { name: 'Submit receipt and reserve', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(committed).toBe(true)
    await expect(page.getByRole('article').filter({ hasText: checkout.id })).toContainText('Payment approved')
    expect(await owned.rows('checkout_receipts', { checkout_id: `eq.${checkout.id}` })).toHaveLength(1)
    expect((await owned.storedCheckoutReceipt(checkout.id)).bytes.equals(receiptBytes)).toBe(true)
  })

  test('CHK-03 REG-UX unknown hold clears only after its matching My bookings continuation; new registration and expiry recover', async ({ owned, scenario, context, page }, info) => {
    await openRegistration(page, owned, scenario.games[1].venue)
    await fillOrganizer(page); await fillPlayer(playerField(page))
    await continueRegistration(page, 'Review registration')
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Review your registration', exact: true })).toBeVisible()
    const requests: string[] = []
    let saved: Checkout | null = null
    await page.route('**/api/club', async route => {
      if (route.request().method() !== 'POST' || route.request().postDataJSON()?.action !== 'checkout.hold') { await route.continue(); return }
      requests.push(route.request().postDataJSON().data.request_id)
      if (!saved) {
        const actual = await route.fetch()
        expect(actual.status()).toBe(200)
        saved = (await actual.json()).checkout
        await route.abort('failed')
      } else await route.continue()
    })
    await page.getByRole('dialog').getByRole('button', { name: 'Register', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Check reservation', exact: true })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'My bookings', exact: true }).click()
    expect(saved).not.toBeNull()
    const checkout = saved as unknown as Checkout
    await page.getByRole('article').filter({ hasText: checkout.id }).getByRole('button', { name: 'Continue to payment', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Payment', exact: true })).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(new Set(requests).size).toBe(1)
    expect((checkout as Checkout & { request_id: string }).request_id).toBe(requests[0])
    await expect(page.getByRole('region', { name: 'Pending reservation status' })).toHaveCount(0)
    expect(await owned.rows('checkouts', { organization_id: `eq.${owned.target.organizationId}` })).toHaveLength(1)
    expect((await owned.rows('checkouts', { id: `eq.${checkout.id}` }))[0].expires_at).toBe(checkout.expires_at)
    await page.getByRole('dialog').locator('input[name="file"]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: receiptBytes })
    await page.getByRole('dialog').getByRole('button', { name: 'Submit receipt and reserve', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Pending reservation status' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Games', exact: true }).click()
    await filterByGameDate(page, scenario.date)
    await registerGameSelection(page, page.getByRole('article').filter({ hasText: owned.venueName }))
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Register', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    const expiring = await confirmedHold(owned, context, owned.draft([individual(owned, scenario.games[2].id)]))
    await owned.expireCheckout(expiring.checkout.id)
    await page.reload(); await page.getByRole('button', { name: 'My bookings', exact: true }).click()
    const booking = page.getByRole('article').filter({ hasText: expiring.checkout.id })
    await expect(booking).toContainText('Expired')
    await booking.getByRole('button', { name: 'View checkout', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('This hold has expired')
    await expect(page.getByRole('dialog').locator('input[name="file"]')).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: info.outputPath('m4-expired-recovery-mobile.png'), fullPage: true })
  })

  test('CHK-03 REG-UX completing unrelated owned checkout B never clears unknown intent A', async ({ owned, scenario, context, page }) => {
    await owned.bootstrap(context)
    const b = await confirmedHold(owned, context, owned.draft([individual(owned, scenario.games[2].id)]))
    await openRegistration(page, owned)
    await fillOrganizer(page); await fillPlayer(playerField(page))
    await continueRegistration(page, 'Review registration')
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Review your registration', exact: true })).toBeVisible()
    let unknownId: string | null = null
    await page.route('**/api/club', async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'checkout.hold' && !unknownId) {
        const actual = await route.fetch(); expect(actual.status()).toBe(200)
        unknownId = (await actual.json()).checkout.id
        await route.abort('failed')
      } else await route.continue()
    })
    await page.getByRole('dialog').getByRole('button', { name: 'Register', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Check reservation', exact: true })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'My bookings', exact: true }).click()
    await page.getByRole('article').filter({ hasText: b.checkout.id }).getByRole('button', { name: 'Continue to payment', exact: true }).click()
    await page.getByRole('dialog').locator('input[name="file"]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: receiptBytes })
    await page.getByRole('dialog').getByRole('button', { name: 'Submit receipt and reserve', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Pending reservation status' })).toBeVisible()
    expect(unknownId === b.checkout.id).toBe(false)
    expect((await owned.rows('checkouts', { id: `eq.${unknownId}` }))[0]).toMatchObject({ status: 'holding', payment_status: 'pending' })
    await page.getByRole('button', { name: 'Games', exact: true }).click()
    await filterByGameDate(page, scenario.date)
    await registerGameSelection(page, page.getByRole('article').filter({ hasText: scenario.games[1].venue }))
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Check reservation', exact: true })).toBeVisible()
  })

  test('REG-UX a delayed real quote cannot overwrite corrected player details', async ({ owned, scenario, page }) => {
    await openRegistration(page, owned)
    await fillOrganizer(page); await fillPlayer(playerField(page))
    let release!: () => void, reached!: () => void, first = true
    const gate = new Promise<void>(resolve => { release = resolve })
    const intercepted = new Promise<void>(resolve => { reached = resolve })
    const pending = page.waitForResponse(response => response.url().endsWith('/api/club') && response.request().postDataJSON()?.action === 'checkout.review' && response.request().postDataJSON()?.data.organizer.name === 'QA Organizer')
    await page.route('**/api/club', async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'checkout.review' && first) { first = false; reached(); await gate }
      await route.continue()
    })
    try {
      await continueRegistration(page, 'Review registration')
      await intercepted
      await page.getByRole('dialog').getByRole('group', { name: 'Organizer', exact: true }).getByLabel(/^Name/).fill('QA Corrected')
      await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click()
      await playerField(page).getByLabel(/^Birthday/).fill('1995-04-13')
      await continueRegistration(page, 'Review registration')
      await expect(page.getByRole('dialog').getByRole('heading', { name: 'Review your registration', exact: true })).toBeVisible()
      await expect(page.getByRole('dialog')).toContainText('Organizer · QA Corrected')
      release()
      // Both real server requests succeed; only the current input owns the UI.
      const oldResponse = await pending
      expect(oldResponse.status()).toBe(200)
      await oldResponse.finished()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))))
      await expect(page.getByRole('dialog')).toContainText('Organizer · QA Corrected')
      await expect(page.getByRole('dialog')).not.toContainText('Organizer · QA Organizer')
      await noNewBookings(owned, scenario.baselineBookingId)
    } finally { release(); await page.unroute('**/api/club') }
  })
})
