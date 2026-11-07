import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Page, type Locator } from '@playwright/test'
import { preflight } from '../../scripts/e2e/target-guard.mjs'
import type { ManagementUsersPage } from '../../src/features/club/model/management-users'
import type { ManagementPayment, PaymentPage } from '../../src/features/club/model/management-payments'
import { OwnedFixture, receiptBytes } from './helpers/owned-fixture'
import { continueRegistration, registerGameSelection, playerField } from './helpers/checkout-harness'
import { filterByGameDate } from './helpers/game-filters'

test.beforeAll(async () => {
  test.setTimeout(660_000)
  // The first phase includes multiple staff mutations. Keep its write window
  // separate from earlier suites without resetting the operational limit.
  await new OwnedFixture(preflight(), true).waitForWriteBudget(60)
})

test('M6 verifies protected role changes and staff management operations', async ({ page, browser }, info) => {
  test.setTimeout(720_000)
  page.setDefaultTimeout(10_000)
  async function captureLayouts(name: string, anchor?: Locator) {
    const previous = page.viewportSize()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      if (anchor) {
        await anchor.scrollIntoViewIfNeeded()
        await anchor.focus()
        await expect(anchor).toBeFocused()
        const bounds = await anchor.boundingBox()
        expect(bounds && bounds.y >= 0 && bounds.y + bounds.height <= (width === 390 ? 844 : 900)).toBeTruthy()
      }
      await info.attach(`${name}-${width}`, { body: await page.screenshot({ animations: 'disabled', fullPage: true }), contentType: 'image/png' })
    }
    if (previous) await page.setViewportSize(previous)
  }
  const target = preflight()
  const fixture = new OwnedFixture(target, true)
  const email = `m6-developer-${target.runId}@example.test`
  const adminEmail = `m6-admin-${target.runId}@example.test`
  const attemptedSignups = new Set<string>()
  const verificationMessageIds = new Set<string>()
  const uploadedQrPaths = new Set<string>()
  let validGameWrite: Record<string, unknown> | undefined
  let fixturePrepared = false
  const adminContext = await browser.newContext({ baseURL: target.appUrl })
  const adminPage = await adminContext.newPage()
  const password = randomBytes(24).toString('base64url')
  const mailer = `supabase_inbucket_${target.projectId}`
  const [auth, inbox] = JSON.parse(execFileSync('docker', ['inspect', target.containers.auth, mailer], { encoding: 'utf8' }))
  expect(auth.Config.Env.includes(`GOTRUE_SMTP_HOST=${mailer}`), 'Auth routes to the owned inbox').toBe(true)
  expect(auth.Config.Env.includes('GOTRUE_MAILER_AUTOCONFIRM=false'), 'Auth requires email confirmation').toBe(true)
  expect(inbox.Config.Labels['com.supabase.cli.project']).toBe(target.projectId)
  expect(Object.keys(inbox.NetworkSettings.Networks)).toEqual(Object.keys(auth.NetworkSettings.Networks))
  const ports = Object.values(inbox.NetworkSettings.Ports).flat()
  expect(ports).toContainEqual({ HostIp: '127.0.0.1', HostPort: '54334' })

  async function service(path: string, method = 'GET', body?: object) {
    if (method !== 'GET') preflight()
    const response = await fetch(`${target.supabaseUrl}/${path}`, {
      method,
      headers: {
        apikey: target.serviceRoleKey,
        Authorization: `Bearer ${target.serviceRoleKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    expect(response.ok, `Owned QA operation: ${method} ${path.split('?')[0]} (HTTP ${response.status})`).toBe(true)
    return response
  }

  async function ownedAuthUser(address: string) {
    const { users } = await (await service('auth/v1/admin/users?page=1&per_page=100')).json()
    return users.find((user: { email: string }) => user.email === address)
  }

  async function authRequest(actor: Page, address: string, action: string, data: object) {
    if (action === 'sign-up') {
      expect(Boolean(await ownedAuthUser(address)), 'Run-owned email is unused before sign-up').toBe(false)
      attemptedSignups.add(address)
    }
    return actor.request.post('/api/club/auth/email', {
      headers: { Origin: target.appUrl }, data: { action, email: address, ...data },
    })
  }

  async function write(actor: Page, action: string, data: object) {
    return actor.request.post('/api/club', {
      headers: { Origin: target.appUrl }, data: { action, data },
    })
  }

  function saveAccess(actor: Page, data: object) {
    return write(actor, 'access.save', data)
  }

  async function users(actor: Page, params: Record<string, string> = {}): Promise<ManagementUsersPage> {
    const result = await actor.request.get('/api/club', { params: { view: 'management-users', ...params } })
    expect(result.status()).toBe(200)
    return result.json()
  }

  async function verifyEmail(actor: Page, address: string) {
    let messageId: string | undefined
    await expect.poll(async () => {
      const response = await fetch('http://127.0.0.1:54334/api/v1/messages')
      if (!response.ok) return false
      const { messages } = await response.json()
      messageId = messages.find((message: { Subject: string; To: { Address: string }[] }) =>
        message.Subject === 'Verify your DVC email' && message.To.some(recipient => recipient.Address === address))?.ID
      return Boolean(messageId)
    }).toBe(true)
    verificationMessageIds.add(messageId!)
    const message = await (await fetch(`http://127.0.0.1:54334/api/v1/message/${encodeURIComponent(messageId!)}`)).json()
    const code = message.HTML.match(/<strong[^>]*>(\d{6,8})<\/strong>/)?.[1]
    expect(Boolean(code), 'Verification code exists in the owned inbox').toBe(true)
    expect((await authRequest(actor, address, 'verify', { code })).status()).toBe(200)
  }

  try {
    await fixture.prepare()
    fixturePrepared = true
    await service('rest/v1/staff_email_whitelist', 'POST', {
      organization_id: target.organizationId, email, role: 'developer', enabled: true,
    })
    expect((await authRequest(page, email, 'sign-up', { password })).status()).toBe(200)
    const unverified = await ownedAuthUser(email)
    expect(Boolean(unverified?.id)).toBe(true)
    expect(unverified.email_confirmed_at ?? null).toBeNull()
    expect((await authRequest(page, email, 'sign-in', { password })).ok()).toBe(false)
    expect((await page.request.get('/api/club?view=management-users')).status()).toBe(403)

    await verifyEmail(page, email)
    const session = await page.request.get('/api/club?view=session')
    expect(session.status()).toBe(200)
    expect(await session.json()).toMatchObject({ role: 'developer', user: { id: unverified.id } })
    expect((await page.request.get('/api/club?view=management-users')).status()).toBe(200)
    await page.goto('/club')
    await page.getByRole('button', { name: 'Manage club', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Users and prepared roles' }).getByText(email, { exact: true })).toBeVisible()

    await test.step('M6-01/03: include an unprepared registered Player and recover Users refresh', async () => {
      const player = await browser.newContext({ baseURL: target.appUrl })
      try {
        await fixture.signIn(player)
        const profile = await player.request.post('/api/club/auth/email', {
          headers: { Origin: target.appUrl },
          data: { action: 'profile', name: 'QA Unprepared Player', level: 'intermediate',
            gender: 'prefer_not_to_say', birth_date: '1995-04-12', first_timer: true },
        })
        expect(profile.status()).toBe(200)
        expect((await users(page, { query: fixture.email })).rows).toMatchObject([{
          email: fixture.email, name: 'QA Unprepared Player', role: 'player',
          registered: true, verified: true, access_id: null,
        }])
      } finally { await player.close() }
      const refresh = page.getByRole('button', { name: 'Refresh', exact: true })
      await refresh.click()
      const directory = page.getByRole('table', { name: 'Users and prepared roles' })
      await expect(directory.getByText('QA Unprepared Player', { exact: true })).toBeVisible()
      const reads = (url: URL) => url.pathname === '/api/club' && url.searchParams.get('view') === 'management-users'
      await page.route(reads, route => route.fulfill({ status: 503, json: { error: 'Synthetic QA Users read failure' } }))
      try {
        await refresh.click()
        await expect(page.getByText('Showing the last loaded results.', { exact: true })).toBeVisible()
        await expect(directory.getByText('QA Unprepared Player', { exact: true })).toBeVisible()
      } finally { await page.unroute(reads) }
      await page.getByRole('button', { name: 'Retry users', exact: true }).click()
      await expect(page.getByText('Showing the last loaded results.', { exact: true })).toHaveCount(0)
      for (const section of ['Users', 'Venues', 'Payments', 'Payment methods', 'Announcements']) {
        await page.getByRole('button', { name: section, exact: true }).click()
        await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
        await captureLayouts(`M6-page-${section}`)
        if (section === 'Venues' || section === 'Payment methods') {
          const label = section === 'Venues' ? 'Add venue' : 'Add payment method'
          const trigger = page.getByRole('button', { name: label, exact: true })
          await trigger.click()
          await captureLayouts(`M6-${label}`)
          await page.keyboard.press('Escape')
          await expect(trigger).toBeFocused()
        }
      }
      await page.getByRole('button', { name: 'Users', exact: true }).click()
      await page.getByRole('button', { name: 'Add email', exact: true }).click()
      await captureLayouts('M6-prepare-access')
      await page.keyboard.press('Escape')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.getByRole('button', { name: 'Add email', exact: true }).click()
      const reducedDialog = page.getByRole('dialog', { name: 'Prepare user access', exact: true })
      expect(await reducedDialog.evaluate(element => ({ name: getComputedStyle(element).animationName, transform: getComputedStyle(element).transform }))).toEqual({ name: 'dvc-fade', transform: 'none' })
      await captureLayouts('M6-reduced-motion')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Edit skill level for QA Unprepared Player', exact: true }).click()
      await captureLayouts('M6-skill-editor')
      await page.keyboard.press('Escape')
    })

    const prepareAdmin = await saveAccess(page, { email: adminEmail.toUpperCase(), role: 'admin', enabled: true, expected_version: null })
    expect(prepareAdmin.status()).toBe(200)
    expect((await users(page, { query: adminEmail })).rows).toMatchObject([
      { email: adminEmail, registered: false, verified: false, access_role: 'admin' },
    ])
    expect((await authRequest(adminPage, adminEmail, 'sign-up', { password })).status()).toBe(200)
    expect((await users(page, { query: adminEmail })).rows).toMatchObject([
      { email: adminEmail, registered: true, verified: false, access_role: 'admin' },
    ])
    await verifyEmail(adminPage, adminEmail)
    expect(await (await adminPage.request.get('/api/club?view=session')).json()).toMatchObject({ role: 'admin' })

    const first = await users(page, { limit: '1' })
    expect(first.rows).toHaveLength(1)
    expect(first.next_cursor).toBeTruthy()
    const second = await users(page, { limit: '1', cursor: first.next_cursor! })
    expect(second.rows).toHaveLength(1)
    expect(second.rows[0].email).not.toBe(first.rows[0].email)
    const continuation = { view: 'management-users', limit: '1', cursor: first.next_cursor! }
    expect((await adminPage.request.get('/api/club', { params: continuation })).status()).toBe(400)
    expect((await page.request.get('/api/club', { params: { ...continuation, role: 'admin' } })).status()).toBe(400)
    expect((await page.request.get('/api/club?view=management-users&limit=51')).status()).toBe(400)
    for (const query of ['limit=0', 'limit=1&limit=2', 'role=unknown', 'cursor=invalid', `query=${'a'.repeat(121)}`]) {
      expect((await page.request.get('/api/club?view=management-users&' + query)).status()).toBe(400)
    }
    const appendedEmail = `zz-m6-appended-${target.runId}@example.test`
    expect((await saveAccess(page, { email: appendedEmail, role: 'facilitator', enabled: true, expected_version: null })).status()).toBe(200)
    const seen = new Set(first.rows.map(row => row.email))
    let cursor = first.next_cursor
    for (let count = 0; cursor && count < 10; count++) {
      const continuation = await users(page, { limit: '1', cursor })
      expect(continuation.rows).toHaveLength(1)
      expect(seen.has(continuation.rows[0].email)).toBe(false)
      seen.add(continuation.rows[0].email)
      cursor = continuation.next_cursor
    }
    expect(cursor).toBeNull()
    expect(seen).toEqual(new Set((await users(page)).rows.map(row => row.email)))
    expect(seen.has(appendedEmail)).toBe(true)
    const directoryFixtures = Array.from({ length: 28 }, (_, index) => ({
      organization_id: target.organizationId,
      email: `zz-directory-${String(index).padStart(2, '0')}-${target.runId}@example.test`,
      role: 'facilitator', enabled: true,
    }))
    await service('rest/v1/staff_email_whitelist', 'POST', directoryFixtures)
    expect((await users(page)).rows).toHaveLength(25)
    const fullDirectory = await users(page, { limit: '50' })
    expect(fullDirectory.rows).toHaveLength(seen.size + directoryFixtures.length)
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    const userPages = page.getByRole('navigation', { name: 'Users pages', exact: true })
    await expect(userPages.getByText('Showing 1–25', { exact: true })).toBeVisible()
    await userPages.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(userPages.getByText(`Showing 26–${fullDirectory.rows.length}`, { exact: true })).toBeVisible()
    await userPages.getByRole('button', { name: 'Previous', exact: true }).click()
    await expect(userPages.getByText('Showing 1–25', { exact: true })).toBeVisible()

    const [developer] = (await users(page, { query: email })).rows
    const [admin] = (await users(adminPage, { query: adminEmail })).rows
    const disable = (row: typeof admin) => ({
      id: row.access_id, email: row.email, role: row.access_role, enabled: false, expected_version: row.version,
    })
    expect((await saveAccess(adminPage, disable(developer))).ok()).toBe(false)

    const pendingEmail = `m6-pending-${target.runId}@example.test`
    expect((await saveAccess(adminPage, { email: pendingEmail, role: 'facilitator', enabled: true, expected_version: null })).status()).toBe(200)
    const [pending] = (await users(adminPage, { query: pendingEmail })).rows
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    const editPending = page.getByRole('button', { name: `Edit role for ${pendingEmail}`, exact: true })
    await expect(page.getByRole('row').filter({ hasText: pendingEmail }).getByRole('button', { name: /^Edit skill level/ })).toHaveCount(0)
    await editPending.click()
    const staleRole = page.getByRole('dialog', { name: 'Edit user role', exact: true })
    expect((await saveAccess(adminPage, { ...disable(pending), enabled: true, role: 'coordinator' })).status()).toBe(200)
    await staleRole.getByRole('combobox', { name: /^Role/ }).selectOption('player')
    await captureLayouts('M6-role-editor')
    const saveStale = staleRole.getByRole('button', { name: 'Save role', exact: true })
    await saveStale.click()
    await expect(staleRole.getByText(/^Access changed\./)).toBeVisible()
    await expect(saveStale).toBeDisabled()
    await staleRole.getByRole('button', { name: 'Close and refresh Users', exact: true }).click()
    await expect(staleRole).toBeHidden()
    await expect(editPending).toBeFocused()
    expect((await users(page, { query: pendingEmail })).rows).toMatchObject([{ access_role: 'coordinator', access_enabled: true }])

    await test.step('M6-02: reject a role edit scoped to another organization', async () => {
      const foreignOrg = randomUUID()
      const foreignId = randomUUID()
      const foreignGame = randomUUID()
      await service('rest/v1/organizations', 'POST', { id: foreignOrg, name: `QA other club ${target.runId}` })
      try {
        await service('rest/v1/staff_email_whitelist', 'POST', {
          id: foreignId, organization_id: foreignOrg, email: adminEmail, role: 'developer', enabled: true,
        })
        await service('rest/v1/games', 'POST', { id: foreignGame, organization_id: foreignOrg, venue: 'Foreign QA court', city: 'QA only', starts_at: fixture.startsAt, ends_at: fixture.endsAt, team_count: 2, team_price: 165000, status: 'published' })
        await service('rest/v1/game_positions', 'POST', ['open', 'opposite', 'middle', 'setter'].map(position => ({ game_id: foreignGame, position, capacity: 4, price: 30000 })))
        expect((await page.request.get('/api/club', { params: { view: 'staff-game-context', id: foreignGame, operation: 'roster' } })).status()).toBe(404)
        expect((await saveAccess(page, { ...disable(admin), id: foreignId })).status()).toBe(409)
        expect(await fixture.rows('staff_email_whitelist', { id: `eq.${foreignId}` }, 'role,enabled'))
          .toEqual([{ role: 'developer', enabled: true }])
      } finally {
        await service(`rest/v1/game_positions?game_id=eq.${foreignGame}`, 'DELETE')
        await service(`rest/v1/games?id=eq.${foreignGame}&organization_id=eq.${foreignOrg}`, 'DELETE')
        await service(`rest/v1/staff_email_whitelist?id=eq.${foreignId}&organization_id=eq.${foreignOrg}`, 'DELETE')
        await service(`rest/v1/organizations?id=eq.${foreignOrg}`, 'DELETE')
        expect(await fixture.rows('organizations', { id: `eq.${foreignOrg}` }, 'id')).toHaveLength(0)
      }
    })

    await test.step('M6-06/07: create a game from Game Management and replay the same request', async () => {
      const venueSave = await write(page, 'venue.save', { name: `QA create court ${target.runId}`, city: 'QA only', enabled: true })
      expect(venueSave.status()).toBe(200)
      const { id: venueId } = await venueSave.json()
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.getByRole('button', { name: 'Game Management', exact: true }).click()
      const create = page.getByRole('button', { name: 'Create game', exact: true })
      await create.click()
      const dialog = page.getByRole('dialog', { name: 'New game' })
      const start = new Date(Date.now() + 4 * 86400_000)
      start.setUTCSeconds(0, 0)
      const end = new Date(start.getTime() + 2 * 3600_000)
      const manila = (instant: Date) => new Date(instant.getTime() + 8 * 3600_000).toISOString().slice(0, 16)
      await dialog.getByLabel(/^Venue/).selectOption(venueId)
      await dialog.getByLabel(/^Teams/).fill('2')
      await dialog.getByLabel(/^Start · Manila time/).fill(manila(start))
      await dialog.getByLabel(/^End · Manila time/).fill(manila(end))
      await dialog.getByLabel('Open Spiker price', { exact: true }).fill('310')
      await dialog.getByLabel(/^Team price · total PHP/).fill('1710')
      await dialog.getByRole('combobox', { name: 'Status', exact: true }).selectOption('published')
      await info.attach('M6-06-desktop-create-game', { body: await dialog.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
      const response = page.waitForResponse(result => result.request().method() === 'POST'
        && new URL(result.url()).pathname === '/api/club' && result.request().postDataJSON()?.action === 'game.save')
      await dialog.getByRole('button', { name: 'Save game', exact: true }).click()
      const saved = await response
      expect(saved.status()).toBe(200)
      const { id } = await saved.json()
      await expect(dialog).toBeHidden()
      await expect(create).toBeFocused()

      const { data } = saved.request().postDataJSON()
      validGameWrite = data
      const replay = await write(page, 'game.save', data)
      expect(replay.status()).toBe(200)
      expect(await replay.json()).toMatchObject({ id })
      expect((await write(page, 'game.save', { ...data, team_price: 172000 })).ok()).toBe(false)
      expect(await fixture.rows('games', { venue_id: `eq.${venueId}` }, 'id,venue_id,team_count,team_price,status,starts_at,ends_at'))
        .toEqual([expect.objectContaining({ id, venue_id: venueId, team_count: 2, team_price: 171000, status: 'published' })])
      const [persisted] = await fixture.rows('games', { id: `eq.${id}` }, 'starts_at,ends_at')
      expect(Date.parse(String(persisted.starts_at))).toBe(start.getTime())
      expect(Date.parse(String(persisted.ends_at))).toBe(end.getTime())
      expect(await fixture.rows('game_positions', { game_id: `eq.${id}`, position: 'eq.open' }, 'capacity,price'))
        .toEqual([{ capacity: 4, price: 31000 }])
      const games = await page.request.get('/api/club?view=games')
      expect(games.status()).toBe(200)
      expect((await games.json()).games).toEqual(expect.arrayContaining([expect.objectContaining({ id })]))

      expect((await write(page, 'game.save', { ...data, ends_at: data.starts_at })).status()).toBe(400)
      const shiftedStart = new Date(start.getTime() + 3600_000).toISOString()
      const shiftedEnd = new Date(end.getTime() + 3600_000).toISOString()
      const edit = { ...data, id, expected_start: data.starts_at, starts_at: shiftedStart, ends_at: shiftedEnd, confirm_change: true }
      expect((await write(page, 'game.save', edit)).status()).toBe(200)
      expect((await write(page, 'game.save', { ...edit, starts_at: start.toISOString() })).status()).toBe(409)
      const [updated] = await fixture.rows('games', { id: `eq.${id}` }, 'starts_at')
      expect(Date.parse(String(updated.starts_at))).toBe(Date.parse(shiftedStart))

      await page.setViewportSize({ width: 390, height: 844 })
      await create.click()
      await expect(dialog.getByLabel(/^Venue/)).toBeVisible()
      await info.attach('M6-07-mobile-create-game', { body: await dialog.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(create).toBeFocused()
      expect(await fixture.rows('games', { venue_id: `eq.${venueId}` }, 'id')).toEqual([{ id }])
    })

    await test.step('M6-03/04: one combined payment, scoped continuation and private receipt', async () => {
      const guest = await browser.newContext({ baseURL: target.appUrl })
      try {
        const nextGame = await fixture.createBrowseGame('Payment second court',
          new Date(Date.parse(fixture.startsAt) + 86400_000).toISOString(),
          new Date(Date.parse(fixture.endsAt) + 86400_000).toISOString(), 'published')
        // Staff may add receipts to manual reserved bookings. Other legacy
        // bookings must still have a valid hold when submitting a first receipt.
        const legacy = await fixture.seedLegacy(guest, null, 'reserved', 'pending', true)
        const games = [fixture.gameId, nextGame.id].map(game_id => ({
          game_id, kind: 'individual' as const, organizer_plays: true, players: [fixture.player('setter')],
        }))
        const { draft, quote } = await fixture.reviewed(guest, fixture.draft(games))
        const held = await fixture.hold(guest, draft)
        expect(held.status()).toBe(200)
        const { checkout } = await held.json()
        expect((await fixture.uploadCheckout(guest, checkout.id)).status()).toBe(200)
        const [storedCheckout] = await fixture.rows('checkouts', { id: `eq.${checkout.id}` }, 'created_at')
        await service(`rest/v1/bookings?id=eq.${legacy.id}&organization_id=eq.${target.organizationId}`, 'PATCH', {
          created_at: storedCheckout.created_at,
        })

        const paymentPage = async (params: Record<string, string> = {}): Promise<PaymentPage<ManagementPayment>> => {
          const response = await page.request.get('/api/club', { params: { view: 'management-payments', ...params } })
          expect(response.status()).toBe(200)
          return response.json()
        }
        const records = await paymentPage()
        expect(records.rows).toHaveLength(2)
        expect(records.rows[0].created_at).toBe(records.rows[1].created_at)
        expect(records.rows).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: checkout.id, kind: 'checkout', amount: quote.amount, payment_status: 'approved' }),
          expect.objectContaining({ id: legacy.id, kind: 'legacy' }),
        ]))
        expect((await paymentPage({ game: nextGame.id })).rows.map(row => row.id)).toEqual([checkout.id])
        const lines = await page.request.get('/api/club', {
          params: { view: 'management-payments', mode: 'checkout', checkout: checkout.id },
        })
        expect(lines.status()).toBe(200)
        expect((await lines.json()).rows).toEqual(expect.arrayContaining(quote.games.map(game =>
          expect.objectContaining({ game_id: game.game_id, amount: game.amount }))))
        const first = await paymentPage({ limit: '1' })
        expect(first.next_cursor).toBeTruthy()
        const continuation = { limit: '1', after: first.next_cursor! }
        expect((await paymentPage(continuation)).rows.map(row => row.id))
          .toEqual(records.rows.filter(row => row.id !== first.rows[0].id).map(row => row.id))
        const params = { view: 'management-payments', ...continuation }
        expect((await adminPage.request.get('/api/club', { params })).status()).toBe(400)
        expect((await page.request.get('/api/club', { params: { ...params, status: 'approved' } })).status()).toBe(400)
        const asset = `/api/club/asset?kind=checkout_receipt&id=${checkout.id}`
        const receipt = await page.request.get(asset)
        expect(receipt.status()).toBe(200)
        expect(await receipt.body()).toEqual(receiptBytes)
        expect(await fixture.rows('checkout_receipts', { checkout_id: `eq.${checkout.id}` }, 'checkout_id')).toHaveLength(1)
        const stranger = await browser.newContext({ baseURL: target.appUrl })
        try {
          expect((await stranger.request.get(asset)).status()).toBe(403)
        } finally { await stranger.close() }

        await page.getByRole('button', { name: 'Manage club', exact: true }).click()
        await page.getByRole('button', { name: 'Payments', exact: true }).click()
        const paymentTable = page.getByRole('table', { name: 'Payments', exact: true })
        const details = paymentTable.getByRole('row').filter({ hasText: checkout.captain_name ?? 'Checkout' })
          .getByRole('button', { name: /^View payment details/ })
        await details.click()
        const paymentDialog = page.getByRole('dialog', { name: 'Checkout payment' })
        await expect(paymentDialog.getByRole('table', { name: 'Checkout game breakdown' }).getByRole('row')).toHaveCount(3)
        await expect(paymentDialog.getByRole('link', { name: 'View checkout receipt' })).toHaveCount(1)
        await expect(paymentDialog.getByRole('button', { name: /^(Approve|Reject)/ })).toHaveCount(0)
        await info.attach('M6-04-mobile-checkout-payment', { body: await paymentDialog.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
        await page.keyboard.press('Escape')
        await expect(paymentDialog).toBeHidden()
        await expect(details).toBeFocused()

        const refresh = page.getByRole('button', { name: 'Refresh', exact: true })
        const paymentRead = (url: URL) => url.pathname === '/api/club'
          && url.searchParams.get('view') === 'management-payments' && !url.searchParams.has('mode')
        await page.route(paymentRead, route => route.fulfill({
          status: 503, json: { error: 'Synthetic QA refresh failure' },
        }))
        try {
          await refresh.click()
          await expect(page.getByText('Showing the last loaded payments.')).toBeVisible()
          await expect(details).toBeVisible()
        } finally { await page.unroute(paymentRead) }
        await page.getByRole('button', { name: 'Retry payments', exact: true }).click()
        await expect(page.getByText('Showing the last loaded payments.')).toHaveCount(0)
        await expect(details).toBeEnabled()

        const slowApproved = (url: URL) => paymentRead(url) && url.searchParams.get('status') === 'approved'
        let releaseApproved!: () => void
        let approvedStarted!: () => void
        const release = new Promise<void>(resolve => { releaseApproved = resolve })
        const started = new Promise<void>(resolve => { approvedStarted = resolve })
        await page.route(slowApproved, async route => {
          approvedStarted()
          await release
          await route.continue().catch(() => undefined) // The superseded fetch may already be aborted.
        })
        await page.getByRole('button', { name: 'Add filter', exact: true }).click()
        const statusFilter = page.getByRole('combobox', { name: 'Payment status' })
        try {
          await statusFilter.selectOption('approved')
          await started
          await statusFilter.selectOption('missing')
          await expect(paymentTable.getByRole('row').filter({ hasText: 'QA Legacy Player' })).toBeVisible()
          await expect(details).toHaveCount(0)
        } finally {
          releaseApproved()
          await page.unrouteAll({ behavior: 'wait' })
        }
        await expect(statusFilter).toHaveValue('missing')
        await expect(details).toHaveCount(0)
        await statusFilter.selectOption('')
        await expect(details).toBeEnabled()

        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          const date = page.getByRole('textbox', { name: 'Find a game by date', exact: true })
          await date.fill(fixture.gameDate)
          const gameFilter = page.getByRole('combobox', { name: 'Payment game', exact: true })
          await expect(gameFilter.locator('option', { hasText: fixture.venueName })).toHaveCount(1)
          await gameFilter.selectOption(fixture.gameId)
          await info.attach(`M6-payment-filter-${width}`, { body: await page.screenshot({ animations: 'disabled', fullPage: true }), contentType: 'image/png' })
          await page.getByRole('button', { name: new RegExp(`^Remove Game: ${fixture.venueName}`) }).click()
          await expect(date).toHaveValue('')
          await expect(gameFilter).toHaveCount(0)
          await expect(details).toBeEnabled()
        }

        await page.getByRole('button', { name: 'Game Management', exact: true }).click()
        const gameActions = page.getByRole('button', { name: new RegExp(`^Actions for ${nextGame.venue}`) })
        await gameActions.click()
        await page.getByRole('button', { name: 'Payments', exact: true }).click()
        const gamePayments = page.getByRole('dialog', { name: 'Game payments', exact: true })
        const scopedTable = gamePayments.getByRole('table', { name: 'Payments', exact: true })
        await expect(scopedTable.getByRole('row')).toHaveCount(2)
        await captureLayouts('GM-payments')
        await expect(scopedTable.getByText('QA Legacy Player', { exact: true })).toHaveCount(0)
        await page.keyboard.press('Escape')
        await expect(gamePayments).toBeHidden()
        await expect(gameActions).toBeFocused()

        for (const [action, title] of [
          ['Roster & lineups', 'Roster & lineups'], ['Register another player', 'Add registration'],
          ['Registrations', 'Game registrations'], ['Assign facilitator', 'Assign facilitator'],
          ['Edit game', 'Edit game'], ['Cancel game', 'Cancel game'],
        ]) {
          await gameActions.click()
          await page.getByRole('button', { name: action, exact: true }).click()
          const operation = page.getByRole('dialog', { name: title, exact: true })
          await expect(operation).toBeVisible()
          await captureLayouts(`GM-dialog-${action}`)
          if (action === 'Register another player' || action === 'Edit game') {
            const lastAction = operation.getByRole('button', { name: action === 'Edit game' ? 'Save game' : 'Add player', exact: true })
            await lastAction.scrollIntoViewIfNeeded()
            await expect(lastAction).toBeVisible()
            await captureLayouts(`GM-bottom-${action}`, lastAction)
          }
          const dismissRequests: string[] = []
          const recordDismissal = (request: import('@playwright/test').Request) => {
            const url = new URL(request.url())
            if (url.pathname === '/api/club' && (request.method() === 'POST'
              || ['staff-game-context', 'staff-games'].includes(url.searchParams.get('view') ?? ''))) {
              dismissRequests.push(request.method() + ' ' + (url.searchParams.get('view') ?? url.pathname))
            }
          }
          page.on('request', recordDismissal)
          try {
            await page.keyboard.press('Escape')
            await expect(operation).toBeHidden()
            await expect(gameActions).toBeFocused()
            expect(dismissRequests).toEqual([])
          } finally { page.off('request', recordDismissal) }
        }

        await page.getByRole('button', { name: 'Manage club', exact: true }).click()
        await page.getByRole('button', { name: 'Payments', exact: true }).click()
        const legacyDetailsTrigger = page.getByRole('button', { name: 'View payment details for QA Legacy Player', exact: true })
        await captureLayouts('M6-payments-populated')
        await legacyDetailsTrigger.click()
        const manualDialog = page.getByRole('dialog', { name: 'Payment details', exact: true })
        await captureLayouts('M6-manual-receipt')
        await manualDialog.getByRole('combobox', { name: /^Payment method/ }).selectOption(fixture.methodId)
        await manualDialog.getByLabel(/^Receipt/).setInputFiles({ name: 'qa-legacy-receipt.png', mimeType: 'image/png', buffer: receiptBytes })
        const uploadedReceipt = page.waitForResponse(response => response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/api/club/upload')
        await manualDialog.getByRole('button', { name: 'Add receipt', exact: true }).click()
        expect((await uploadedReceipt).status()).toBe(200)
        await expect(manualDialog.getByRole('link', { name: 'View receipt', exact: true })).toBeVisible()
        expect((await paymentPage({ status: 'review' })).rows).toMatchObject([{ id: legacy.id, kind: 'legacy' }])
        for (const [action, title] of [['Reject', 'Reject receipt'], ['Cancel booking', 'Cancel booking'], ['Transfer', 'Transfer booking']]) {
          const trigger = manualDialog.getByRole('button', { name: action, exact: true })
          await trigger.click()
          const decision = page.getByRole('dialog', { name: title, exact: true })
          await expect(decision).toBeVisible()
          await captureLayouts(`M6-payment-${title}`)
          await page.keyboard.press('Escape')
          await expect(decision).toBeHidden()
          await expect(trigger).toBeFocused()
        }
        await manualDialog.getByRole('button', { name: 'Approve', exact: true }).click()
        const approval = page.getByRole('dialog', { name: 'Approve receipt', exact: true })
        await captureLayouts('M6-receipt-approval')
        await approval.getByRole('button', { name: 'Approve receipt', exact: true }).click()
        await expect(manualDialog).toBeHidden()
        expect((await paymentPage({ status: 'approved' })).rows).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: legacy.id, kind: 'legacy', booking: expect.objectContaining({ payment_status: 'approved' }) }),
          expect.objectContaining({ id: checkout.id, kind: 'checkout' }),
        ]))

        const ineligible = await fixture.seedLegacy(guest, null, 'reserved', 'pending')
        const denied = await adminPage.request.post('/api/club/upload', {
          headers: { Origin: target.appUrl },
          multipart: { kind: 'receipt', booking: ineligible.id, method: fixture.methodId,
            file: { name: 'qa-ineligible.png', mimeType: 'image/png', buffer: receiptBytes } },
        })
        expect(denied.status()).toBe(409)
        const rejection = await denied.json()
        expect(rejection).toMatchObject({ code: 'RECEIPT_NOT_ELIGIBLE', reference: expect.any(String) })
        expect(await fixture.objectMissing(`receipts/${ineligible.id}/${rejection.reference}.png`)).toBe(true)
        expect((await paymentPage({ query: ineligible.id })).rows).toMatchObject([{ booking: { id: ineligible.id, manual: false } }])
        await page.getByRole('button', { name: 'Manage club', exact: true }).click()
        await page.getByRole('button', { name: 'Payments', exact: true }).click()
        await page.getByRole('button', { name: 'Add filter', exact: true }).click()
        await page.getByRole('searchbox', { name: 'Search payments' }).fill(ineligible.id)
        const filtered = page.waitForResponse(response => paymentRead(new URL(response.url()))
          && new URL(response.url()).searchParams.get('query') === ineligible.id && response.ok())
        await page.getByRole('button', { name: 'Search', exact: true }).click()
        await filtered
        const legacyDetails = page.getByRole('button', { name: 'View payment details for QA Legacy Player', exact: true })
        await expect(legacyDetails).toHaveCount(1)
        await legacyDetails.click()
        const legacyDialog = page.getByRole('dialog', { name: 'Payment details', exact: true })
        await expect(legacyDialog.getByText('Awaiting receipt', { exact: true })).toBeVisible()
        await expect(legacyDialog.getByRole('button', { name: 'Add receipt', exact: true })).toHaveCount(0)
        await info.attach('M6-04-mobile-ineligible-legacy-receipt', {
          body: await legacyDialog.screenshot({ animations: 'disabled' }), contentType: 'image/png',
        })
        await page.keyboard.press('Escape')
        await expect(legacyDetails).toBeFocused()

        const destination = await fixture.createBrowseGame('Transfer destination',
          new Date(Date.parse(nextGame.startsAt) + 2 * 86400_000).toISOString(),
          new Date(Date.parse(nextGame.endsAt) + 2 * 86400_000).toISOString())
        const moved = checkout.bookings.find((booking: { game_id: string }) => booking.game_id === nextGame.id)
        expect((await write(page, 'booking.transfer', { id: moved.id, game_id: destination.id })).status()).toBe(200)
        expect((await paymentPage({ game: nextGame.id })).rows).toHaveLength(0)
        expect((await paymentPage({ game: destination.id })).rows).toMatchObject([{ id: checkout.id, amount: quote.amount }])
        expect((await write(page, 'game.cancel', { id: destination.id })).status()).toBe(200)
        expect((await paymentPage({ game: destination.id })).rows).toMatchObject([{ id: checkout.id, amount: quote.amount }])
        expect(await fixture.rows('bookings', { id: `eq.${moved.id}` }, 'game_id,status'))
          .toEqual([{ game_id: destination.id, status: 'cancelled' }])
        expect((await page.request.get(asset)).status()).toBe(200)
        expect(await fixture.rows('checkout_receipts', { checkout_id: `eq.${checkout.id}` }, 'checkout_id')).toHaveLength(1)
      } finally { await guest.close() }
    })

    await test.step('M6-05: edit and archive a referenced venue without rewriting its scheduled game', async () => {
      const venue = { id: fixture.venueId, name: `${fixture.venueName} updated`, city: 'QA only', enabled: true }
      await page.getByRole('button', { name: 'Venues', exact: true }).click()
      await page.getByRole('button', { name: `Edit ${fixture.venueName}`, exact: true }).click()
      const editor = page.getByRole('dialog', { name: 'Edit venue' })
      const name = editor.getByRole('textbox', { name: /^Venue/ })
      const maps = editor.getByRole('textbox', { name: /^Google Maps link/ })
      await name.fill(venue.name)
      await maps.fill('https://example.test/not-maps')
      const save = editor.getByRole('button', { name: 'Save venue', exact: true })
      await save.click()
      await expect(maps).toHaveAttribute('aria-invalid', 'true')
      await captureLayouts('M6-venue-validation')
      await expect(maps).toHaveAccessibleDescription('Use a valid HTTPS Google Maps link')
      await expect(editor.getByText('Use a valid HTTPS Google Maps link', { exact: true }).last()).toBeVisible()
      await expect(name).toHaveValue(venue.name)
      await info.attach('M6-07-mobile-venue-validation', {
        body: await editor.screenshot({ animations: 'disabled' }), contentType: 'image/png',
      })
      await maps.clear()
      await save.click()
      await expect(editor).toBeHidden()
      const archive = page.getByRole('button', { name: `Delete ${venue.name}`, exact: true })
      await expect(archive).toBeVisible()
      expect(await fixture.rows('venues', { id: `eq.${fixture.venueId}` }, 'name,enabled'))
        .toEqual([{ name: venue.name, enabled: true }])
      await archive.click()
      const confirmation = page.getByRole('dialog', { name: 'Delete venue', exact: true })
      await expect(confirmation).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(confirmation).toBeHidden()
      await expect(archive).toBeFocused()
      expect(await fixture.rows('venues', { id: `eq.${fixture.venueId}` }, 'enabled')).toEqual([{ enabled: true }])
      await archive.click()
      await captureLayouts('M6-venue-archive')
      await confirmation.getByRole('button', { name: 'Delete venue', exact: true }).click()
      await expect(confirmation).toBeHidden()
      expect(await fixture.rows('venues', { id: `eq.${fixture.venueId}` }, 'enabled')).toEqual([{ enabled: false }])
      expect(await fixture.rows('games', { id: `eq.${fixture.gameId}` }, 'venue,venue_id'))
        .toEqual([{ venue: fixture.venueName, venue_id: fixture.venueId }])
    })

    await test.step('M6-06: publish and unpublish a scheduled announcement', async () => {
      const title = `QA announcement ${target.runId}`
      const publish_at = new Date(Date.now() - 60_000).toISOString()
      const ends_at = new Date(Date.now() + 300_000).toISOString()
      const announcement = { title, body: 'Synthetic M6 acceptance notice', enabled: true, publish_at, ends_at }
      expect((await write(page, 'announcement.save', { ...announcement, ends_at: publish_at })).status()).toBe(400)
      await page.getByRole('button', { name: 'Announcements', exact: true }).click()
      await page.getByRole('button', { name: 'New announcement', exact: true }).click()
      const editor = page.getByRole('dialog', { name: 'New announcement', exact: true })
      const manila = (value: string) => new Date(Date.parse(value) + 8 * 3600_000).toISOString().slice(0, 16)
      await editor.getByRole('textbox', { name: /^Title/ }).fill(title)
      await editor.getByRole('textbox', { name: /^Announcement/ }).fill(announcement.body)
      await editor.getByLabel(/^Publish at · Manila time/).fill(manila(publish_at))
      const end = editor.getByLabel(/^End at · Manila time/)
      await end.fill(manila(publish_at))
      await captureLayouts('M6-announcement-editor')
      const save = editor.getByRole('button', { name: 'Save announcement', exact: true })
      await save.click()
      await expect(editor.getByText('Enter a publish time and a later end time.', { exact: true })).toBeVisible()
      await end.fill(manila(ends_at))
      await save.click()
      await expect(editor).toBeHidden()
      const [persisted] = await fixture.rows('club_announcements', { organization_id: `eq.${target.organizationId}`, title: `eq.${title}` }, 'id')
      const { id } = persisted
      const feed = async () => {
        const result = await page.request.get('/api/club?view=announcements')
        expect(result.status()).toBe(200)
        return result.json()
      }
      expect(await feed()).toEqual(expect.arrayContaining([expect.objectContaining({ id, title })]))
      await captureLayouts('M6-announcements-populated')
      const unpublish = page.getByRole('button', { name: `Unpublish ${title}`, exact: true })
      await unpublish.click()
      const confirmation = page.getByRole('dialog', { name: 'Unpublish announcement?' })
      await captureLayouts('M6-announcement-confirmation')
      await confirmation.getByRole('button', { name: 'Keep current status', exact: true }).click()
      await expect(unpublish).toBeFocused()
      expect(await feed()).toEqual(expect.arrayContaining([expect.objectContaining({ id })]))
      await unpublish.click()
      await confirmation.getByRole('button', { name: 'Unpublish', exact: true }).click()
      await expect(confirmation).toBeHidden()
      expect(await feed()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id })]))
      expect(await fixture.rows('club_announcements', { id: `eq.${id}` }, 'title,enabled')).toEqual([{ title, enabled: false }])
    })

    await test.step('M6-05: attach a real QR and hide it when the method is disabled', async () => {
      const upload = (buffer: Buffer) => adminPage.request.post('/api/club/upload', {
        headers: { Origin: target.appUrl },
        multipart: { kind: 'qr', payment_method: fixture.methodId,
          file: { name: 'qa-qr.png', mimeType: 'image/png', buffer } },
      })
      expect((await upload(Buffer.from('invalid image'))).status()).toBe(400)
      const uploaded = await upload(receiptBytes)
      expect(uploaded.status()).toBe(200)
      const { path, proof } = await uploaded.json()
      expect(typeof path === 'string' && path.startsWith(`payments/${target.organizationId}/`)
        && /^[a-f0-9-]{36}\.png$/.test(path.split('/').at(-1)!)).toBe(true)
      uploadedQrPaths.add(path)
      const method = { id: fixture.methodId, label: 'QA Updated Method', account_name: 'Synthetic QA only',
        account_number: 'DO NOT PAY', qr_path: path, enabled: true }
      const withoutProof = await write(adminPage, 'payment.save', method)
      expect(withoutProof.ok()).toBe(false)
      expect(await fixture.rows('payment_methods', { id: `eq.${fixture.methodId}` }, 'qr_path'))
        .toEqual([{ qr_path: null }])
      expect((await write(adminPage, 'payment.save', { ...method, qr_proof: proof })).status()).toBe(200)
      const asset = `/api/club/asset?kind=qr&id=${fixture.methodId}`
      const qr = await adminPage.request.get(asset)
      expect(qr.status()).toBe(200)
      expect(await qr.body()).toEqual(receiptBytes)
      await page.getByRole('button', { name: 'Payment methods', exact: true }).click()
      const edit = page.getByRole('button', { name: `Edit ${method.label}`, exact: true })
      await edit.click()
      const editor = page.getByRole('dialog', { name: 'Edit payment method', exact: true })
      await captureLayouts('M6-payment-method-editor')
      const available = editor.getByRole('checkbox', { name: 'Available to players' })
      await available.uncheck()
      const save = editor.getByRole('button', { name: 'Save method', exact: true })
      const api = (url: URL) => url.pathname === '/api/club'
      await page.route(api, route => route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'payment.save'
        ? route.fulfill({ status: 503, json: { error: 'Synthetic QA payment save failure' } }) : route.continue())
      try {
        await save.click()
        await expect(editor.getByText('Synthetic QA payment save failure', { exact: true })).toBeVisible()
        await expect(available).not.toBeChecked()
        await info.attach('M6-07-mobile-payment-method-save-failure', {
          body: await editor.screenshot({ animations: 'disabled' }), contentType: 'image/png',
        })
        expect(await fixture.rows('payment_methods', { id: `eq.${fixture.methodId}` }, 'enabled')).toEqual([{ enabled: true }])
      } finally { await page.unroute(api) }
      await save.click()
      await expect(editor).toBeHidden()
      await expect(edit).toBeFocused()
      expect((await adminPage.request.get(asset)).status()).toBe(404)
      expect(await fixture.rows('payment_methods', { id: `eq.${fixture.methodId}` }, 'label,enabled,qr_path'))
        .toEqual([{ label: method.label, enabled: false, qr_path: path }])
    })

    await test.step('GM-01/02: page tied games with composed filters and recover continuation failure', async () => {
      const venueId = randomUUID(), venue = `QA Paging ${target.runId}`
      await service('rest/v1/venues', 'POST', { id: venueId, organization_id: target.organizationId, name: venue, city: 'QA only', enabled: true })
      const starts = new Date(Date.now() + 20 * 86400_000).toISOString()
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(starts))
      const ids = Array.from({ length: 28 }, () => randomUUID()).sort()
      const midnight = Date.parse(`${date}T00:00:00+08:00`)
      const gameRows = ids.map((id, index) => {
        const start = index === 0 ? midnight : index === ids.length - 1 ? midnight + 86400_000 - 1000 : Date.parse(starts)
        return { id, organization_id: target.organizationId, venue_id: venueId, venue, city: 'QA only', starts_at: new Date(start).toISOString(),
          ends_at: new Date(start + 7200_000).toISOString(), status: 'published', team_count: 2, team_price: 100000 }
      })
      const seededGames = [...gameRows,
        { ...gameRows[2], id: randomUUID(), venue_id: fixture.venueId },
        { ...gameRows[2], id: randomUUID(), status: 'draft' },
        { ...gameRows[2], id: randomUUID(), starts_at: new Date(midnight - 1000).toISOString(), ends_at: new Date(midnight + 7199_000).toISOString() },
        { ...gameRows[2], id: randomUUID(), starts_at: new Date(midnight + 86400_000).toISOString(), ends_at: new Date(midnight + 93600_000).toISOString() },
      ]
      await service('rest/v1/games', 'POST', seededGames)
      await service('rest/v1/game_positions', 'POST', seededGames.flatMap(game => ['open', 'opposite', 'middle', 'setter'].map(position => ({ game_id: game.id, position, capacity: 4, price: 30000 }))))
      const filters = { view: 'staff-games', venueId, from: date, to: date, status: 'published', sort: 'asc' }
      const first = await page.request.get('/api/club', { params: filters })
      expect(first.status()).toBe(200)
      const initial = await first.json()
      expect(initial.rows.map((row: { id: string }) => row.id)).toEqual(ids.slice(0, 25))
      const next = await page.request.get('/api/club', { params: { ...filters, after: initial.next_cursor } })
      expect(await next.json()).toMatchObject({ rows: ids.slice(25).map(id => ({ id })), next_cursor: null })
      const descending = await (await page.request.get('/api/club', { params: { ...filters, sort: 'desc' } })).json()
      expect(descending.rows.map((row: { id: string }) => row.id)).toEqual([...ids].reverse().slice(0, 25))
      for (const other of [{ ...filters, sort: 'desc' }, { ...filters, status: '' }, { ...filters, venueId: fixture.venueId }]) {
        expect((await page.request.get('/api/club', { params: { ...other, after: initial.next_cursor } })).status()).toBe(400)
      }
      expect((await adminPage.request.get('/api/club', { params: { ...filters, after: initial.next_cursor } })).status()).toBe(400)
      for (const query of ['sort=invalid', 'from=2026-02-30', 'after=invalid', 'status=unknown', 'sort=asc&sort=desc']) {
        expect((await page.request.get('/api/club?view=staff-games&' + query)).status()).toBe(400)
      }
      await page.getByRole('button', { name: 'Game Management', exact: true }).click()
      await page.getByRole('button', { name: 'Add filter', exact: true }).click()
      await page.getByRole('combobox', { name: 'Venue', exact: true }).selectOption(venueId)
      await page.getByLabel('From date', { exact: true }).fill(date)
      await page.getByLabel('Through date', { exact: true }).fill(date)
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
      await expect(page.getByText('Showing 1–25', { exact: false })).toBeVisible()
      await captureLayouts('GM-filtered-page-one')
      const continuation = (url: URL) => url.pathname === '/api/club' && url.searchParams.get('view') === 'staff-games' && url.searchParams.has('after')
      await page.route(continuation, route => route.fulfill({ status: 503, json: { error: 'Synthetic QA continuation failure' } }))
      try {
        await page.getByRole('button', { name: 'Next', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Retry games', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: /^Actions for QA Paging/ })).toHaveCount(25)
      } finally { await page.unroute(continuation) }
      await page.getByRole('button', { name: 'Retry games', exact: true }).click()
      await expect(page.getByText('Showing 26–28', { exact: false })).toBeVisible()
      await captureLayouts('GM-filtered-page-two')
      await page.getByRole('button', { name: 'Previous', exact: true }).click()
      await expect(page.getByText('Showing 1–25', { exact: false })).toBeVisible()
      const manageClub = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Manage club', exact: true })
      await manageClub.click()
      await expect(manageClub).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible()
    })

    await test.step('GM-04/05: staff skill changes preserve holds and decline stale future registrations', async () => {
      // Reserve enough room for this sequence and the final role checks before
      // creating the short-lived holds used by the skill-change assertions.
      const waitedMs = await fixture.waitForWriteBudget(38)
      await info.attach('skill-and-role-write-budget', { body: JSON.stringify({ waitedMs, requiredWriteBudget: 38 }), contentType: 'application/json' })
      const player = await browser.newContext({ baseURL: target.appUrl })
      try {
        await fixture.signIn(player)
        const game = await fixture.createBrowseGame('Skill history',
          new Date(Date.now() + 8 * 86400_000).toISOString(),
          new Date(Date.now() + 8 * 86400_000 + 7200_000).toISOString(), 'published', 4)
        const inputs = [{ game_id: game.id, kind: 'individual' as const, organizer_plays: true, players: [fixture.player('open')] }]
        const old = await fixture.reviewed(player, fixture.draft(inputs))
        const committed = await fixture.hold(player, old.draft)
        expect(committed.status()).toBe(200)
        const before = await fixture.rows('bookings', { game_id: `eq.${game.id}` })
        const rosterBefore = await fixture.rows('roster_entries', { booking_id: `eq.${before[0].id}` })
        const stale = await fixture.reviewed(player, fixture.draft(inputs))
        // Restore the owned method as setup after the separate disable acceptance check.
        await service(`rest/v1/payment_methods?id=eq.${fixture.methodId}&organization_id=eq.${target.organizationId}`, 'PATCH', { enabled: true })
        const playerPage = await player.newPage()
        await playerPage.setViewportSize({ width: 390, height: 844 })
        await playerPage.goto('/club')
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(game.startsAt))
        await filterByGameDate(playerPage, date)
        const card = playerPage.getByRole('article').filter({ has: playerPage.getByRole('heading', { name: game.venue, exact: true }) })
        await registerGameSelection(playerPage, card)
        await playerField(playerPage).getByLabel(/^Position/).selectOption('opposite')
        await playerField(playerPage).getByRole('radio', { name: 'Returnee', exact: true }).check()
        const originalReview = playerPage.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'checkout.review')
        await continueRegistration(playerPage, 'Review registration')
        const originalRequest = (await originalReview).request().postDataJSON().data.request_id

        const [user] = (await users(page, { query: fixture.email })).rows
        const profile = user.skill_profile!
        await page.bringToFront()
        await page.getByRole('button', { name: 'Manage club', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Users', exact: true }).click()
        const refreshed = page.waitForResponse(response => new URL(response.url()).searchParams.get('view') === 'management-users' && response.ok())
        await page.getByRole('button', { name: 'Refresh', exact: true }).click()
        await refreshed
        const edit = page.getByRole('row').filter({ hasText: fixture.email }).getByRole('button', { name: /^Edit skill level/ })
        await edit.click()
        const editor = page.getByRole('dialog', { name: 'Edit skill level', exact: true })
        await editor.getByRole('combobox', { name: /^Skill level/ }).selectOption('advanced')
        await editor.getByRole('button', { name: 'Save skill level', exact: true }).click()
        await expect(editor).toBeHidden()
        await expect(edit).toBeFocused()
        const [updated] = (await users(page, { query: fixture.email })).rows
        expect(updated.skill_profile).toMatchObject({ level: 'advanced', user_id: profile.user_id })
        expect((await write(adminPage, 'profile.skill.save', { user_id: profile.user_id, level: 'intermediate_plus', expected_version: profile.version })).status()).toBe(409)
        expect((await fixture.hold(player, old.draft)).status()).toBe(200)
        expect(await fixture.rows('bookings', { game_id: `eq.${game.id}` })).toEqual(before)
        expect(await fixture.rows('roster_entries', { booking_id: `eq.${before[0].id}` })).toEqual(rosterBefore)
        const decline = await fixture.hold(player, stale.draft)
        expect(decline.status()).toBe(409)
        expect(await decline.json()).toMatchObject({ code: 'CHECKOUT_SELECTION_CONFLICT', conflicts: [{ game_id: game.id, code: 'SKILL_CHANGED' }] })
        expect(await fixture.rows('checkout_declined_intents', { organization_id: `eq.${target.organizationId}`, request_id: `eq.${stale.draft.request_id}` })).toHaveLength(1)
        const staleUi = playerPage.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'checkout.hold')
        await playerPage.getByRole('dialog').getByRole('button', { name: 'Register', exact: true }).click()
        expect((await staleUi).status()).toBe(409)
        await expect(playerField(playerPage).getByLabel(/^Skill level/)).toHaveValue('advanced')
        await expect(playerField(playerPage).getByLabel(/^Position/)).toHaveValue('opposite')
        await expect(playerField(playerPage).getByRole('radio', { name: 'Returnee', exact: true })).toBeChecked()
        expect(await playerPage.getByRole('dialog').evaluate(element => element.contains(document.activeElement))).toBe(true)
        expect(await playerPage.locator('a.club-skip[href="#club-main"]').evaluate(element => getComputedStyle(element).top)).toBe('-100px')
        await info.attach('GM-skill-recovery-mobile', { body: await playerPage.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
        const newReview = playerPage.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'checkout.review')
        await continueRegistration(playerPage, 'Review registration')
        expect((await newReview).request().postDataJSON().data.request_id).not.toBe(originalRequest)
        const newHold = playerPage.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'checkout.hold')
        await playerPage.getByRole('dialog').getByRole('button', { name: 'Register', exact: true }).click()
        expect((await newHold).status()).toBe(200)

        const advanced = await fixture.reviewed(player, fixture.draft([{ ...inputs[0], players: [{ ...inputs[0].players[0], level: 'advanced' }] }]))
        expect((await fixture.hold(player, advanced.draft)).status()).toBe(200)
        const gameBookings = await fixture.rows('bookings', { organization_id: `eq.${target.organizationId}`, game_id: `eq.${game.id}` }, 'id')
        const gameRoster = await fixture.rows('roster_entries', { booking_id: `in.(${gameBookings.map(row => row.id).join(',')})` }, 'level')
        expect(gameRoster.filter(row => row.level === 'advanced')).toHaveLength(2)
        const [latest] = (await users(page, { query: fixture.email })).rows
        const reset = await write(adminPage, 'profile.skill.save', { user_id: profile.user_id, level: 'intermediate', expected_version: latest.skill_profile!.version })
        expect(reset.status()).toBe(200)
        const audit = await fixture.rows('developer_events', { organization_id: `eq.${target.organizationId}`, action: 'eq.profile.skill.save', kind: 'eq.activity' }, 'actor_id,entity_id,details')
        expect(audit).toEqual(expect.arrayContaining([
          { actor_id: unverified.id, entity_id: profile.user_id, details: { previous_level: 'intermediate', level: 'advanced' } },
          { actor_id: (await ownedAuthUser(adminEmail)).id, entity_id: profile.user_id, details: { previous_level: 'advanced', level: 'intermediate' } },
        ]))
        expect(audit).toHaveLength(2)
        const declinedReplay = await fixture.hold(player, stale.draft)
        expect(declinedReplay.status()).toBe(409)
        expect(await declinedReplay.json()).toMatchObject({ code: 'CHECKOUT_SELECTION_CONFLICT', conflicts: [{ game_id: game.id, code: 'SKILL_CHANGED' }] })
        expect((await write(page, 'profile.skill.save', { user_id: pendingEmail, level: 'advanced', expected_version: '1' })).status()).toBe(400)
        const foreign = await browser.newContext({ baseURL: target.appUrl })
        const foreignOrg = randomUUID()
        try {
          const foreignUser = await fixture.signIn(foreign, true)
          await service('rest/v1/organizations', 'POST', { id: foreignOrg, name: `QA foreign skill ${target.runId}` })
          await service('rest/v1/player_profiles', 'POST', { organization_id: foreignOrg, user_id: foreignUser, name: 'QA foreign player', contact: 'foreign-player@example.test', level: 'intermediate', gender: 'prefer_not_to_say', birth_date: '1995-04-12', first_timer: true })
          const [foreignProfile] = await fixture.rows('player_profiles', { organization_id: `eq.${foreignOrg}` })
          const foreignDenied = await write(page, 'profile.skill.save', { user_id: foreignUser, level: 'advanced', expected_version: '1' })
          expect(foreignDenied.status()).toBe(409)
          expect(await foreignDenied.json()).toMatchObject({ error: 'Player profile not found' })
          expect(await fixture.rows('player_profiles', { organization_id: `eq.${foreignOrg}` })).toEqual([foreignProfile])
        } finally {
          await service(`rest/v1/player_profiles?organization_id=eq.${foreignOrg}`, 'DELETE')
          await service(`rest/v1/organizations?id=eq.${foreignOrg}`, 'DELETE')
          await foreign.close()
        }
        expect((await write(playerPage, 'profile.skill.save', { user_id: profile.user_id, level: 'advanced', expected_version: profile.version })).status()).toBe(403)
      } finally { await player.close() }
    })

    const waitedMs = await fixture.waitForWriteBudget(18)
    await info.attach('staff-write-budget-pacing', { body: JSON.stringify({ waitedMs, windowSeconds: 600, limitUnchanged: true }), contentType: 'application/json' })
    for (const role of ['coordinator', 'facilitator'] as const) {
      const previousGamePage = await (await adminPage.request.get('/api/club?view=staff-games')).json()
      expect(previousGamePage.next_cursor).toBeTruthy()
      const [current] = (await users(page, { query: adminEmail })).rows
      expect((await saveAccess(page, { ...disable(current), role, enabled: true })).status()).toBe(200)
      expect(await (await adminPage.request.get('/api/club?view=session')).json()).toMatchObject({ role })
      expect((await adminPage.request.get('/api/club?view=management-users')).status()).toBe(403)
      expect((await saveAccess(adminPage, disable(developer))).status()).toBe(403)
      expect((await write(adminPage, 'venue.delete', { id: fixture.venueId })).status()).toBe(403)
      expect((await adminPage.request.get('/api/club?view=staff-games')).status()).toBe(200)
      expect((await adminPage.request.get('/api/club', { params: { view: 'staff-games', after: previousGamePage.next_cursor } })).status()).toBe(400)
      for (const operation of ['manual', 'registrations', 'facilitators', 'payments', 'edit', 'cancel']) {
        const permitted = role === 'coordinator' && ['manual', 'registrations', 'facilitators'].includes(operation)
        expect((await adminPage.request.get('/api/club', { params: { view: 'staff-game-context', id: fixture.gameId, operation } })).status()).toBe(permitted ? 200 : 403)
      }
      expect((await adminPage.request.get('/api/club', { params: { view: 'staff-game-context', id: fixture.gameId, operation: 'roster' } })).status()).toBe(role === 'coordinator' ? 200 : 403)
      for (const enabled of [true, false]) {
        expect((await write(adminPage, 'faci.self', { game_id: fixture.gameId, enabled })).status()).toBe(200)
        expect(await fixture.rows('game_facilitators', { game_id: `eq.${fixture.gameId}`, user_id: `eq.${(await ownedAuthUser(adminEmail)).id}` })).toHaveLength(enabled ? 1 : 0)
      }
      const [skillTarget] = (await users(page, { query: fixture.email })).rows
      expect((await write(adminPage, 'profile.skill.save', { user_id: skillTarget.skill_profile!.user_id, level: 'advanced', expected_version: skillTarget.skill_profile!.version })).status()).toBe(403)
      expect(validGameWrite).toBeDefined()
      expect((await write(adminPage, 'game.save', validGameWrite!)).status()).toBe(403)
    }
    const [facilitator] = (await users(page, { query: adminEmail })).rows
    expect((await saveAccess(page, { ...disable(facilitator), role: 'admin', enabled: true })).status()).toBe(200)
    const [restoredAdmin] = (await users(adminPage, { query: adminEmail })).rows
    const [developerResult, adminResult] = await Promise.all([
      saveAccess(page, disable(developer)), saveAccess(adminPage, disable(restoredAdmin)),
    ])
    expect([developerResult.ok(), adminResult.ok()].filter(Boolean)).toHaveLength(1)
    const removed = developerResult.ok() ? page : adminPage
    const retained = developerResult.ok() ? adminPage : page
    expect(await (await removed.request.get('/api/club?view=session')).json()).toMatchObject({ role: 'player' })
    expect((await removed.request.get('/api/club?view=management-users')).status()).toBe(403)
    expect((await write(removed, 'venue.delete', { id: fixture.venueId })).status()).toBe(403)
    expect((await retained.request.get('/api/club?view=management-users')).status()).toBe(200)
  } finally {
    try {
      await adminContext.close()
      for (const path of uploadedQrPaths) {
        await service(`storage/v1/object/dvc-private/${path}`, 'DELETE')
        expect(await fixture.objectMissing(path), 'Owned QR object was removed').toBe(true)
      }
    } finally {
      try {
        if (fixturePrepared) {
          // The application service role intentionally has no table access.
          if (JSON.stringify(preflight()) !== JSON.stringify(target)) throw new Error('Owned QA target changed during cleanup')
          const remaining = execFileSync('docker', ['exec', '-i', target.containers.database, 'psql', '-XqAt',
            '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-v', `fixture_org=${target.organizationId}`,
            '-v', `fixture_name=DVC M1 owned fixture ${target.runId}`], {
            input: `begin;
              delete from public.game_creation_intents where organization_id = :'fixture_org'::uuid
                and exists (select 1 from public.organizations where id = :'fixture_org'::uuid and name = :'fixture_name');
              select count(*) from public.game_creation_intents where organization_id = :'fixture_org'::uuid;
              commit;`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
          }).trim()
          expect(remaining, 'Owned game creation intents were removed').toBe('0')
        }
      } finally {
        await fixture.dispose()
      }
    }
    // Games and announcement rows can still reference these actors.
    for (const address of attemptedSignups) {
      const user = await ownedAuthUser(address)
      if (!user) continue
      await service(`auth/v1/admin/users/${encodeURIComponent(user.id)}`, 'DELETE')
      expect(Boolean(await ownedAuthUser(address)), 'Owned Auth fixture was removed').toBe(false)
    }
    if (verificationMessageIds.size) {
      const deletion = await fetch('http://127.0.0.1:54334/api/v1/messages', { method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [...verificationMessageIds] }),
      })
      expect(deletion.ok, 'Owned verification messages were removed').toBe(true)
      for (const id of verificationMessageIds) {
        expect((await fetch(`http://127.0.0.1:54334/api/v1/message/${encodeURIComponent(id)}`)).status).toBe(404)
      }
    }
  }
})
