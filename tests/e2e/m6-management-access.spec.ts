import { test, expect, type BrowserContext } from '@playwright/test'
import { preflight } from '../../scripts/e2e/target-guard.mjs'
import { OwnedFixture } from './helpers/owned-fixture'

test('M6 direct management boundaries deny guests and genuine Player sessions', async ({ browser }, info) => {
  test.setTimeout(660_000)
  const target = preflight()
  const fixture = new OwnedFixture(target, true)
  const contexts: BrowserContext[] = []

  try {
    // Both actors' denied writes count toward the application's shared window.
    const waitedMs = await fixture.waitForWriteBudget(12)
    await info.attach('rate-window-precondition', { body: JSON.stringify({ waitedMs, requiredWriteBudget: 12 }), contentType: 'application/json' })
    await fixture.prepare()
    for (const actor of ['guest', 'player'] as const) {
      const context = await browser.newContext({ baseURL: target.appUrl, timezoneId: 'Asia/Manila', serviceWorkers: 'block' })
      contexts.push(context)
      const userId = actor === 'player' ? await fixture.signIn(context) : null
      const page = await context.newPage()
      await page.goto('/club')
      await expect(page.getByRole('heading', { name: 'Games', exact: true })).toBeVisible()
      const session = await page.request.get('/api/club?view=session')
      expect(session.status()).toBe(200)
      expect(await session.json()).toMatchObject({ role: 'player', user: userId ? { id: userId } : null })
      await expect(page.getByRole('button', { name: 'Manage club', exact: true })).toHaveCount(0)
      for (const view of ['management-users', 'management-payments', 'management-venues', 'management-methods', 'staff-games', 'staff-game-context&id=' + fixture.gameId + '&operation=roster']) {
        const response = await page.request.get(`/api/club?view=${view}`)
        expect(response.status(), `${actor} cannot read ${view}`).toBe(403)
        expect(await response.json()).toMatchObject({ code: 'ACCESS_DENIED' })
      }
      for (const [action, data] of [
        ['access.save', { email: fixture.email, role: 'admin', enabled: true, expected_version: null }],
        ['venue.save', { id: fixture.venueId, name: 'Unauthorized change', city: 'QA only', enabled: false }],
        ['payment.save', { id: fixture.methodId, label: 'Unauthorized change', account_name: 'QA only', account_number: 'DO NOT PAY', enabled: false }],
        ['game.cancel', { id: fixture.gameId }],
        ['profile.skill.save', { user_id: userId || fixture.gameId, level: 'advanced', expected_version: '1' }],
      ] as const) {
        const denied = await page.request.post('/api/club', { headers: { Origin: target.appUrl }, data: { action, data } })
        expect(denied.status(), `${actor} cannot execute ${action}`).toBe(403)
        expect(await denied.json()).toMatchObject({ code: 'ACCESS_DENIED' })
      }
      expect(await fixture.rows('venues', { id: `eq.${fixture.venueId}` }, 'name,enabled')).toEqual([{ name: fixture.venueName, enabled: true }])
      expect(await fixture.rows('games', { id: `eq.${fixture.gameId}` }, 'status')).toEqual([{ status: 'published' }])
      expect(await fixture.rows('payment_methods', { id: `eq.${fixture.methodId}` }, 'enabled')).toEqual([{ enabled: true }])
      expect(await fixture.rows('staff_email_whitelist', { organization_id: `eq.${target.organizationId}` })).toHaveLength(0)
    }
    await info.attach('scope', {
      body: 'Real local REST and genuine GoTrue Player session. This test covers protected read/write denial, unchanged stored state and navigation. Staff-enabled CRUD, Auth confirmation UI, private Storage and the broader M6 acceptance plan are separate.',
      contentType: 'text/plain',
    })
  } finally {
    for (const context of contexts) await context.close()
    const cleanup = await fixture.dispose()
    await info.attach('owned-fixture-cleanup', { body: JSON.stringify(cleanup, null, 2), contentType: 'application/json' })
  }
})
