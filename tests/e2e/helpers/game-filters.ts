import type { Page } from '@playwright/test'

export async function openGameFilters(page: Page) {
  const toggle = page.locator('.club-games-browser .club-filter-toggle')
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
}

export async function filterByGameDate(page: Page, date: string) {
  await openGameFilters(page)
  await page.getByLabel('Game date', { exact: true }).fill(date)
}
