import { filterByGameDate, openGameFilters } from './helpers/game-filters'
import { test, expect, type Page } from '@playwright/test'
import { preflight } from '../../scripts/e2e/target-guard.mjs'
import { OwnedFixture, type GamesScenario } from './helpers/owned-fixture'
import { discardRegistration, registerGameSelection, fillOrganizer } from './helpers/checkout-harness'

// Approved revised M2 coverage. Real service responses are never replaced with
// successful mocks. Staff-allowed checks remain blocked on supported local OAuth.
test.describe('M2 real-service Games browsing and selection', () => {
  let fixture: OwnedFixture
  let scenario: GamesScenario
  const layout = (page: Page, name: string) => page.getByRole('group', { name: 'Schedule layout' }).getByRole('button', { name, exact: true })
  const card = (page: Page, venue: string) => page.getByRole('article').filter({ has: page.getByRole('heading', { name: venue, exact: true }) })
  const row = (page: Page, venue: string) => page.getByRole('table', { name: 'Available games' }).getByRole('row').filter({ hasText: venue })
  const selection = (page: Page) => page.getByRole('region', { name: 'Game selection' })
  async function openGames(page: Page) {
    await page.goto('/club')
    await expect(page.getByRole('heading', { name: 'Games', exact: true })).toBeVisible()
    await filterByGameDate(page, scenario.date)
    await expect(card(page, fixture.venueName)).toBeVisible()
  }
  async function noNewHolds() {
    expect(await fixture.rows('bookings', { organization_id: `eq.${fixture.target.organizationId}` }, 'id,status')).toEqual([{ id: scenario.baselineBookingId, status: 'reserved' }])
    expect(await fixture.rows('checkouts', { organization_id: `eq.${fixture.target.organizationId}` }, 'id')).toEqual([])
  }
  test.beforeAll(async () => { fixture = new OwnedFixture(preflight(), true); await fixture.prepare(); scenario = await fixture.prepareGamesScenario() })
  test.afterAll(async ({}, info) => { if (fixture) await info.attach('owned-fixture-cleanup', { body: JSON.stringify(await fixture.dispose(), null, 2), contentType: 'application/json' }) })

  test('M2-01/02 simultaneous games stay distinct and date/venue filters survive both layouts', async ({ page }) => {
    await openGames(page)
    const [base, early, parallel] = scenario.games
    await expect(page.locator('.club-schedule-day')).toHaveCount(1)
    const headings = await page.locator('.club-schedule-day article h3').allTextContents()
    expect(headings).toEqual([early.venue, ...[base, parallel].sort((a, b) => a.id.localeCompare(b.id)).map(game => game.venue)])
    await expect(page.getByLabel('Week of')).toHaveCount(0)
    await expect(layout(page, 'Calendar')).toHaveCount(0)
    await openGameFilters(page)
    await page.getByRole('combobox', { name: /^Available position/ }).selectOption('setter')
    for (const mode of ['Table', 'List']) {
      await layout(page, mode).click()
      await expect(page.getByLabel('Game date', { exact: true })).toHaveValue(scenario.date)
      await expect(page.getByRole('combobox', { name: /^Available position/ })).toHaveValue('setter')
      if (mode === 'Table') for (const game of [early, base, parallel]) await expect(row(page, game.venue)).toHaveCount(1)
    }
    await page.getByRole('combobox', { name: /^Venue/ }).selectOption(fixture.venueId)
    await expect(page.locator('.club-schedule-day article')).toHaveCount(1)
    await expect(card(page, base.venue)).toBeVisible()
    await page.getByRole('combobox', { name: /^Venue/ }).selectOption('')
    await expect(page.locator('.club-schedule-day article')).toHaveCount(3)
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await filterByGameDate(page, '2099-01-05')
    await expect(page.getByText('No games match these filters.', { exact: true })).toBeVisible()
    await noNewHolds()
  })

  test('M2-03/06 real effective prices, capacity and public roster omit private fields', async ({ page }) => {
    await openGames(page)
    const main = card(page, fixture.venueName)
    await expect(main).toContainText('11 slots left')
    const openPosition = main.locator('.club-position-grid > div').filter({ hasText: 'Open Spiker' })
    await expect(openPosition).toContainText('3 left'); await expect(openPosition).toContainText('₱275')
    await expect(openPosition.getByLabel('Regular price ₱300')).toBeVisible()
    await expect(main.locator('footer')).toContainText('₱1,500')
    const waiting = page.waitForResponse(response => new URL(response.url()).searchParams.get('view') === 'roster')
    await main.getByRole('button', { name: 'Players', exact: true }).click()
    const response = await waiting; expect(response.status()).toBe(200)
    const roster = await response.json()
    expect(roster).toHaveLength(1); expect(Object.keys(roster[0]).sort()).toEqual(['id', 'name', 'position', 'team'])
    expect(roster[0]).toMatchObject({ name: 'Synthetic', position: 'open', team: 1 })
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Synthetic')
    for (const value of ['PrivateName', '1995-04-12', 'private-player@example.test', 'private-organizer@example.test', 'private-contact@example.test']) await expect(dialog).not.toContainText(value)
    await page.keyboard.press('Escape')
    expect((await page.request.get('/api/club?view=workspace')).status()).toBe(403)
    await expect(page.getByRole('button', { name: 'Manage club', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'More actions', exact: true })).toHaveCount(0)
    await noNewHolds()
  })

  test('M2-04 selection stays unique across layouts and date filters without holds', async ({ page }) => {
    await openGames(page)
    const [base, , parallel, next] = scenario.games
    await card(page, base.venue).getByRole('button', { name: /^Select / }).click()
    await layout(page, 'Table').click()
    await expect(row(page, base.venue).getByRole('button', { name: /^Selected:/ })).toHaveAttribute('aria-pressed', 'true')
    await row(page, parallel.venue).getByRole('button', { name: /^Select / }).click()
    await expect(selection(page).getByRole('heading', { name: 'Selected games (2)', exact: true })).toBeVisible()
    await filterByGameDate(page, scenario.nextWeek)
    await expect(row(page, next.venue)).toBeVisible()
    await selection(page).getByRole('button', { name: 'View selected games', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: /^Remove / })).toHaveCount(2)
    await expect(dialog).toContainText(base.venue); await expect(dialog).toContainText(parallel.venue)
    await dialog.getByRole('button', { name: new RegExp(`^Remove ${parallel.venue}`) }).click()
    await page.keyboard.press('Escape')
    await filterByGameDate(page, scenario.date)
    await layout(page, 'List').click()
    await card(page, base.venue).getByRole('button', { name: /^Selected:/ }).click()
    await expect(selection(page)).toHaveCount(0); await noNewHolds()
  })

  test('M2-05/07 public details target the right game and return keyboard focus', async ({ page }) => {
    await openGames(page); await layout(page, 'Table').click()
    const parallel = scenario.games[2]
    const details = row(page, parallel.venue).getByRole('button', { name: 'Details', exact: true })
    await details.focus(); await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog').getByRole('heading', { name: parallel.venue, exact: true })).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('heading', { name: fixture.venueName, exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape'); await expect(details).toBeFocused()
    await registerGameSelection(page, row(page, parallel.venue))
    await fillOrganizer(page)
    await expect(page.getByRole('dialog')).toContainText(parallel.venue)
    await discardRegistration(page); await noNewHolds()
  })

  test('M2-05/07 a delayed roster never replaces the latest game context', async ({ page }) => {
    await openGames(page); await layout(page, 'Table').click()
    const [first, , latest] = scenario.games
    let release!: () => void, reached!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), intercepted = new Promise<void>(resolve => { reached = resolve })
    const pattern = `**/api/club?view=roster&game=${first.id}`
    await page.route(pattern, async route => { reached(); await gate; await route.continue() })
    const pending = page.waitForResponse(response => new URL(response.url()).searchParams.get('view') === 'roster' && new URL(response.url()).searchParams.get('game') === first.id)
    try {
      await row(page, first.venue).getByRole('button', { name: 'Players', exact: true }).click(); await intercepted
      await page.keyboard.press('Escape')
      await row(page, latest.venue).getByRole('button', { name: 'Details', exact: true }).click()
      release(); const response = await pending; expect(response.status()).toBe(200); await response.finished()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))))
      await expect(page.getByRole('dialog')).toHaveCount(1)
      await expect(page.getByRole('dialog').getByRole('heading', { name: latest.venue, exact: true })).toBeVisible()
      await expect(page.getByRole('dialog').getByRole('table', { name: 'Registered players' })).toHaveCount(0)
      await page.keyboard.press('Escape'); await noNewHolds()
    } finally { release(); await page.unroute(pattern) }
  })

  test('M2-05/07 selected-game Details returns focus to its stable summary control', async ({ page }) => {
    await openGames(page)
    const selected = scenario.games[0]
    await card(page, selected.venue).getByRole('button', { name: /^Select / }).click()
    const opener = selection(page).getByRole('button', { name: 'View selected games', exact: true })
    await opener.focus(); await page.keyboard.press('Enter')
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^Details for ${selected.venue}`) }).click()
    await expect(page.getByRole('dialog', { name: /^Game ·/ }).getByRole('heading', { name: selected.venue, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Selected games (1)', exact: true }).getByRole('button', { name: /^Details for / })).toBeFocused()
    await page.keyboard.press('Escape'); await expect(opener).toBeFocused(); await noNewHolds()
  })

  test('M2-04/05 removing the last off-date selection closes Details and restores Refresh focus', async ({ page }) => {
    await openGames(page)
    const selected = scenario.games[0]
    await card(page, selected.venue).getByRole('button', { name: /^Select / }).click()
    await filterByGameDate(page, scenario.nextWeek)
    await expect(card(page, scenario.games[3].venue)).toBeVisible()
    await selection(page).getByRole('button', { name: 'View selected games', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^Details for ${selected.venue}`) }).click()
    await page.getByRole('dialog', { name: /^Game ·/ }).getByRole('button', { name: /^Selected:/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0); await expect(selection(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeFocused()
    await expect(card(page, scenario.games[3].venue)).toBeVisible(); await noNewHolds()
  })

  test('M2-06/07/08 Player denial, real offline recovery and responsive evidence', async ({ page, context }, info) => {
    await fixture.signIn(context); await openGames(page)
    await expect(page.getByRole('button', { name: 'Manage club', exact: true })).toHaveCount(0)
    expect((await page.request.get('/api/club?view=workspace')).status()).toBe(403)
    await expect(page.getByRole('navigation', { name: 'Club contact links' }).getByRole('link')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Instagram|Messenger/ })).toHaveCount(0)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const pattern = '**/api/club?view=games&**'
    await page.route(pattern, async route => { await gate; await route.continue() })
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    try {
      await expect(page.getByRole('status').filter({ hasText: 'Updating games' })).toBeVisible()
      await expect(card(page, fixture.venueName)).toBeVisible()
      await page.screenshot({ path: info.outputPath('m2-refresh-retains-games.png'), fullPage: true })
    } finally { release() }
    await expect(page.getByRole('status').filter({ hasText: 'Updating games' })).toHaveCount(0)
    await page.unroute(pattern)
    const applicationAlerts = page.getByRole('main').getByRole('alert')
    await context.setOffline(true)
    try { await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(applicationAlerts.first()).toBeVisible(); await expect(card(page, fixture.venueName)).toBeVisible() }
    finally { await context.setOffline(false) }
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(applicationAlerts).toHaveCount(0)
    await card(page, fixture.venueName).getByRole('button', { name: /^Select / }).click()
    for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(selection(page)).toBeVisible()
      await page.screenshot({ path: info.outputPath(`m2-selected-${viewport.name}.png`), fullPage: true })
    }
    await selection(page).getByRole('button', { name: 'View selected games', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await noNewHolds()
    await info.attach('verification-boundary', { body: 'Real local app/REST/Auth, delayed actual GET and offline recovery. Contact URLs absent by configuration; staff-allowed/Google UI and live email remain BLOCKED, not passed.', contentType: 'text/plain' })
  })

  test('UX-GAMES-01 upcoming defaults, independent history flags and full versus lifecycle labels', async ({ page }) => {
    const stamp = (offset: number) => new Date(Date.now() + offset).toISOString()
    const ongoing = await fixture.createBrowseGame('Ongoing', stamp(-30 * 60_000), stamp(90 * 60_000))
    const ended = await fixture.createBrowseGame('Ended', stamp(-180 * 60_000), stamp(-60 * 60_000))
    const cancelled = await fixture.createBrowseGame('Cancelled', stamp(-120 * 60_000), stamp(-30 * 60_000), 'cancelled')
    const full = await fixture.createBrowseGame('Full', stamp(24 * 3600_000), stamp(26 * 3600_000), 'published', 0)
    const partial = await fixture.createBrowseGame('Partial full', stamp(27 * 3600_000), stamp(29 * 3600_000))
    await fixture.patchPosition(partial.id, 'setter', { capacity: 0 })
    await page.goto('/club')
    await expect(page.getByLabel('Game date', { exact: true })).toHaveValue('')
    await expect(card(page, ongoing.venue)).toContainText('In progress')
    await expect(card(page, ongoing.venue)).not.toContainText('left')
    await expect(card(page, ongoing.venue).getByRole('button', { name: /^Select / })).toBeDisabled()
    await expect(card(page, full.venue).getByRole('button', { name: /^Select / })).toBeDisabled()
    await expect(card(page, partial.venue).locator('.club-position-grid > div').filter({ hasText: 'Setter' })).toContainText('Full')
    await expect(card(page, partial.venue).getByRole('button', { name: /^Select / })).toBeEnabled()
    await expect(card(page, ended.venue)).toHaveCount(0); await expect(card(page, cancelled.venue)).toHaveCount(0)
    await openGameFilters(page); await page.getByRole('checkbox', { name: 'Include completed', exact: true }).check()
    await expect(card(page, ended.venue)).toContainText('Completed'); await expect(card(page, cancelled.venue)).toHaveCount(0)
    await expect(card(page, ended.venue)).not.toContainText('left')
    await page.getByRole('checkbox', { name: 'Include completed', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: 'Include cancelled', exact: true }).check()
    await expect(card(page, cancelled.venue)).toContainText('Cancelled'); await expect(card(page, ended.venue)).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'Include completed', exact: true }).check()
    await expect(card(page, ended.venue)).toContainText('Completed')
    const ids = await page.locator('.club-schedule-day article h3').allTextContents()
    expect(ids.indexOf(ongoing.venue)).toBeLessThan(ids.indexOf(ended.venue))
    await layout(page, 'Table').click()
    for (const [game, label] of [[ongoing, 'In progress'], [ended, 'Completed'], [cancelled, 'Cancelled'], [full, 'Full']] as const) {
      const gameRow = row(page, game.venue)
      await expect(gameRow.getByRole('cell').first().getByText(label, { exact: true })).toBeVisible()
      await expect(gameRow.getByRole('button', { name: /^Select / })).toBeDisabled()
    }
    await noNewHolds()
  })

  test('UX-GAMES-02 delayed selected-game read cannot reopen checkout after dismissal; plain close does not refetch', async ({ page }) => {
    await openGames(page)
    await card(page, fixture.venueName).getByRole('button', { name: /^Select / }).click()
    const opener = selection(page).getByRole('button', { name: 'View selected games', exact: true })
    await opener.click()
    let release!: () => void, reached!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), intercepted = new Promise<void>(resolve => { reached = resolve })
    const pattern = '**/api/club?view=selected-games&**'
    await page.route(pattern, async route => { reached(); await gate; await route.continue() })
    const pending = page.waitForResponse(response => new URL(response.url()).searchParams.get('view') === 'selected-games')
    try {
      await page.getByRole('dialog').getByRole('button', { name: 'Continue to registration', exact: true }).click(); await intercepted
      await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0)
      release(); const response = await pending; expect(response.status()).toBe(200); await response.finished()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))))
      await expect(page.getByRole('dialog')).toHaveCount(0); await expect(opener).toBeFocused()
    } finally { release(); await page.unroute(pattern) }
    await registerGameSelection(page, card(page, fixture.venueName))
    await expect(page.getByRole('dialog').getByRole('group', { name: 'Player 1 details', exact: true })).toBeVisible()
    let collectionReads = 0
    const listener = (request: import('@playwright/test').Request) => { if (request.method() === 'GET' && ['games','mine','workspace','selected-games'].includes(new URL(request.url()).searchParams.get('view') || '')) collectionReads++ }
    page.on('request', listener)
    await page.keyboard.press('Escape')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))))
    expect(collectionReads).toBe(0); page.off('request', listener); await noNewHolds()
  })

  test('UX-GAMES-03 bounded pagination has no skipped tied games and preserves off-page selected details', async ({ page }, info) => {
    const start = scenario.games[0].startsAt, end = scenario.games[0].endsAt
    for (let index = 0; index < 16; index++) await fixture.createBrowseGame(`Page ${index}`, start, end)
    // Tied UUID ordering may put the baseline Court on either page. The Early
    // game is strictly earlier than every tie and therefore anchors page one.
    await page.goto('/club')
    await filterByGameDate(page, scenario.date)
    await expect(card(page, scenario.games[1].venue)).toBeVisible()
    const pages = page.getByRole('navigation', { name: 'Games pages', exact: true })
    await expect(pages.getByRole('status')).toHaveText('Showing 1–12')
    await expect(pages.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
    await info.attach('Games list pagination desktop', { body: await pages.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    const results: string[] = [], ids: string[] = []
    let cursor = ''
    do {
      const response = await page.request.get(`/api/club?view=games&date=${scenario.date}${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`)
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.games.length).toBeLessThanOrEqual(12)
      results.push(...body.games.map((game: { venue: string }) => game.venue)); ids.push(...body.games.map((game: { id: string }) => game.id))
      cursor = body.next_cursor || ''
    } while (cursor)
    expect(ids).toHaveLength(19); expect(new Set(ids).size).toBe(ids.length)
    expect(results).toContain(fixture.venueName)
    const first = page.locator('.club-schedule-day article').first()
    const selectedVenue = await first.locator('h3').textContent()
    await first.getByRole('button', { name: /^Select / }).click()
    const isNextPage = (url: URL) => url.pathname === '/api/club' && url.searchParams.get('view') === 'games' && Boolean(url.searchParams.get('after'))
    await page.route(isNextPage, route => route.abort('failed'), { times: 1 })
    const next = pages.getByRole('button', { name: 'Next', exact: true })
    await next.press('Enter')
    const retry = page.getByRole('button', { name: 'Retry games', exact: true })
    await expect(retry).toBeVisible()
    await expect(pages.getByRole('status')).toHaveText('Showing 1–12')
    await expect(card(page, selectedVenue!)).toBeVisible()
    const nextPage = page.waitForResponse(response => isNextPage(new URL(response.url())))
    await retry.click()
    expect((await nextPage).status()).toBe(200)
    await expect(card(page, selectedVenue!)).toHaveCount(0)
    await expect(pages.getByRole('status')).toHaveText('Showing 13–19')
    await expect(next).toBeDisabled()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(pages.getByRole('status')).toHaveText('Showing 13–19')
    await info.attach('Games table pagination mobile', { body: await pages.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    await selection(page).getByRole('button', { name: 'View selected games', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText(selectedVenue!)
    await expect(page.getByRole('dialog')).not.toContainText('no longer available')
    await page.keyboard.press('Escape')
    await expect(selection(page).getByRole('button', { name: 'View selected games', exact: true })).toBeFocused()
    const previous = pages.getByRole('button', { name: 'Previous', exact: true })
    await previous.focus()
    await expect(previous).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(pages.getByRole('status')).toHaveText('Showing 1–12')
    await expect(previous).toBeDisabled()
    await expect(previous).toBeFocused()
    await noNewHolds()
  })
})
