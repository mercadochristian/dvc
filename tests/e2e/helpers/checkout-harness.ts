import { filterByGameDate } from './game-filters'
import { test as base, expect, type BrowserContext, type Page, type Locator } from '@playwright/test'
import type { Checkout, CheckoutDraft, CheckoutGameInput } from '../../../src/features/club/model/types'
import { preflight } from '../../../scripts/e2e/target-guard.mjs'
import { OwnedFixture, type GamesScenario, receiptBytes } from './owned-fixture'

export const test = base.extend<{ owned: OwnedFixture; scenario: GamesScenario }>({
  owned: async ({}, use, info) => {
    info.setTimeout(660_000) // Natural 600s rate-window pacing is part of setup.
    const fixture = new OwnedFixture(preflight(), true)
    const budgets: [RegExp, number][] = [[/kinds, repeated/, 18], [/profile persists/, 6], [/mixed games share/, 5], [/durable declined/, 7], [/simultaneous owners/, 8], [/positive replay/, 10], [/review consent/, 10], [/real (database|storage) failure/, 5], [/cookie-less/, 7], [/two-page Web Locks/, 9], [/missing Web Locks/, 2], [/own profile autofills/, 5], [/mixed forms review/, 8], [/dropped browser response/, 5], [/unknown hold/, 9], [/unrelated owned checkout/, 9], [/delayed real quote/, 6], [/UNI-01/, 8], [/UNI-02/, 6], [/EDIT-01/, 20], [/EDIT-02/, 10], [/UNI-UX-01/, 4], [/EDIT-UX-01/, 10], [/UNI-UX-02/, 4], [/EDIT-UX-02/, 8], [/UX-WIZ-01/, 2], [/UX-WIZ-02/, 0], [/UX-WIZ-03/, 0]]
    const required = budgets.find(([pattern]) => pattern.test(info.title))?.[1] ?? 15
    try {
      const waitedMs = await fixture.waitForWriteBudget(required)
      await info.attach('rate-window-precondition', { body: JSON.stringify({ waitedMs, requiredWriteBudget: required, windowSeconds: 600, limitUnchanged: true, rowsReset: false }), contentType: 'application/json' })
      await fixture.prepare(); await use(fixture)
    }
    finally {
      const cleanup = await fixture.dispose()
      await info.attach('owned-fixture-cleanup', { body: JSON.stringify(cleanup), contentType: 'application/json' })
    }
  },
  scenario: async ({ owned }, use) => {
    const scenario = await owned.prepareGamesScenario()
    // The actual persisted capacity accommodates a five-player repeated role;
    // the synthetic reserved baseline still consumes one Open slot.
    for (const game of scenario.games) {
      await owned.patchGame(game.id, { team_count: 4 })
      for (const position of ['open', 'middle', 'opposite', 'setter']) await owned.patchPosition(game.id, position, { capacity: position === 'open' || position === 'middle' ? 8 : 4 })
    }
    await use(scenario)
  },
})
export { expect, receiptBytes }
export type { Checkout, CheckoutDraft, CheckoutGameInput }

export function individual(owned: OwnedFixture, gameId: string): CheckoutGameInput {
  return { game_id: gameId, kind: 'individual', organizer_plays: true, players: [owned.player()] }
}
export async function confirmedHold(owned: OwnedFixture, context: BrowserContext, draft: CheckoutDraft): Promise<{ checkout: Checkout; draft: CheckoutDraft }> {
  const reviewed = await owned.reviewed(context, draft)
  const response = await owned.hold(context, reviewed.draft)
  expect(response.status()).toBe(200)
  return { checkout: (await response.json()).checkout, draft: reviewed.draft }
}
export async function openRegistration(page: Page, owned: OwnedFixture, venue = owned.venueName) {
  await page.goto('/club')
  await filterByGameDate(page, owned.gameDate)
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: venue, exact: true }) })
  await registerGameSelection(page, card)
  await expect(playerField(page)).toBeVisible()
}
export async function registerGameSelection(page: Page, game: Locator) {
  const dock = page.getByRole('region', { name: 'Game selection' })
  const select = game.locator('.club-game-select')
  if (await dock.isVisible()) {
    await dock.getByRole('button', { name: 'View selected games', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const remove = dialog.getByRole('button', { name: /^Remove / })
    while (await remove.count()) await remove.first().click()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  }
  await select.click()
  await dock.getByRole('button', { name: /^(Continue to registration|Check reservation)$/ }).click()
}
export async function fillOrganizer(page: Page, name = 'QA Organizer') {
  await playerField(page).getByLabel('Name', { exact: true }).fill(name)
}
export async function fillBookingContact(page: Page) {
  const organizer = page.getByRole('dialog').getByRole('group', { name: 'Organizer', exact: true })
  const email = organizer.getByLabel('Email', { exact: true })
  if (await email.isEditable()) await email.fill('qa-organizer@example.test')
  else await expect(email).not.toHaveValue('')
}
export async function continueRegistration(page: Page, action: 'Review registration' | 'Next game' | 'Add another player') {
  const dialog = page.getByRole('dialog')
  const next = dialog.getByRole('button', { name: 'Next', exact: true })
  const contact = dialog.getByRole('group', { name: 'Organizer', exact: true })
  if (await next.isVisible()) {
    await next.click()
    const choice = dialog.getByRole('region', { name: 'Additional player choice' })
    if (await choice.isVisible()) {
      const footer = dialog.locator('footer[aria-label="Registration total"]')
      await footer.getByRole('button', { name: action === 'Add another player' ? 'Yes' : 'No', exact: true }).click()
    } else {
      await dialog.getByRole('button', { name: action === 'Review registration' ? 'Continue to contact' : action, exact: true }).click()
    }
  } else if (!(await contact.isVisible())) {
    await dialog.getByRole('button', { name: action === 'Review registration' ? 'Continue to contact' : action, exact: true }).click()
  }
  if (action === 'Review registration') {
    await fillBookingContact(page)
    await dialog.getByRole('button', { name: action, exact: true }).click()
  }
}
export async function fillPlayer(player: Locator, birthDate = '1995-04-12') {
  await player.getByRole('checkbox', { name: 'Player details available', exact: true }).check()
  await player.getByLabel(/^Skill level/).selectOption('intermediate')
  await player.getByLabel(/^Gender/).selectOption('prefer_not_to_say')
  await player.getByLabel(/^Birthday/).fill(birthDate)
  await player.getByRole('radio', { name: 'First-timer', exact: true }).check()
}
export function playerField(page: Page, index = 1) { return page.getByRole('dialog').getByRole('group', { name: `Player ${index} details`, exact: true }) }
export async function noNewBookings(owned: OwnedFixture, baselineId: string) {
  expect(await owned.rows('bookings', { organization_id: `eq.${owned.target.organizationId}` }, 'id')).toEqual([{ id: baselineId }])
  expect(await owned.rows('checkouts', { organization_id: `eq.${owned.target.organizationId}` })).toHaveLength(0)
}

export async function activatePlayer(page: Page, index = 1, region?: Locator) {
  const row = (region || page.getByRole('dialog')).locator('.club-checkout-person').nth(index - 1)
  const details = row.locator('details')
  if (await details.getAttribute('open') === null) await row.locator('summary').click()
  await expect((region || page.getByRole('dialog')).getByRole('group', { name: `Player ${index} details`, exact: true })).toBeVisible()
}

export async function playerPositions(page: Page, count: number) {
  const positions: string[] = []
  for (let index = 1; index <= count; index++) {
    await activatePlayer(page, index)
    positions.push(await playerField(page, index).getByLabel(/^Position/).inputValue())
  }
  return positions
}

/** Intentional pre-hold discard is explicit; payment/recovery close has its own
 * existing continuation semantics and must not use this helper. */
export async function discardRegistration(page: Page, via: 'escape' | 'close' = 'escape') {
  const dialog = page.getByRole('dialog')
  if (via === 'escape') await page.keyboard.press('Escape')
  else await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Discard registration?', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Discard registration', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}
