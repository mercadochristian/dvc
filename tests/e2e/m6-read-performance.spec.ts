import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { test, expect } from '@playwright/test'
import { preflight } from '../../scripts/e2e/target-guard.mjs'
import { OwnedFixture } from './helpers/owned-fixture'

test('M6 approved read workload stays under one second with two readers', async ({ browser }, info) => {
  test.setTimeout(180_000)
  const target = preflight()
  const fixture = new OwnedFixture(target, true)
  const context = await browser.newContext({ baseURL: target.appUrl })
  const accounts = Array.from({ length: 1000 }, (_, index) => ({
    id: randomUUID(), email: `load-${index}-${target.runId}@example.test`,
  }))
  const readerEmail = `load-reader-${target.runId}@example.test`
  let readerAttempted = false
  let prepared = false
  const accountIds = accounts.map(account => `'${account.id}'::uuid`).join(',')
  function sql(statement: string) {
    if (JSON.stringify(preflight()) !== JSON.stringify(target)) throw new Error('Owned workload target changed')
    return execFileSync('docker', ['exec', '-i', target.containers.database,
      'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim()
  }
  async function insert(table: string, rows: object[]) {
    for (let offset = 0; offset < rows.length; offset += 250) {
      if (JSON.stringify(preflight()) !== JSON.stringify(target)) throw new Error('Owned workload target changed')
      const response = await fetch(`${target.supabaseUrl}/rest/v1/${table}`, {
        method: 'POST', headers: { apikey: target.serviceRoleKey, Authorization: `Bearer ${target.serviceRoleKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(rows.slice(offset, offset + 250)),
      })
      expect(response.status, `Owned workload insert into ${table}`).toBe(201)
    }
  }
  try {
    await fixture.prepare()
    prepared = true
    const [auth] = JSON.parse(execFileSync('docker', ['inspect', target.containers.auth], { encoding: 'utf8' }))
    expect(auth.Config.Env.includes(`GOTRUE_SMTP_HOST=supabase_inbucket_${target.projectId}`)).toBe(true)
    expect(auth.Config.Env.includes('GOTRUE_MAILER_AUTOCONFIRM=false')).toBe(true)
    expect(sql(`select count(*) from auth.users where email='${readerEmail}';`)).toBe('0')
    await insert('staff_email_whitelist', [{ organization_id: target.organizationId, email: readerEmail, role: 'developer', enabled: true }])
    readerAttempted = true
    const signup = await context.request.post('/api/club/auth/email', { headers: { Origin: target.appUrl }, data: { action: 'sign-up', email: readerEmail, password: randomUUID() } })
    expect(signup.status()).toBe(200)
    let messageId = ''
    await expect.poll(async () => {
      const { messages } = await (await fetch('http://127.0.0.1:54334/api/v1/messages')).json()
      messageId = messages.find((message: { Subject: string; To: { Address: string }[] }) => message.Subject === 'Verify your DVC email' && message.To.some(recipient => recipient.Address === readerEmail))?.ID || ''
      return Boolean(messageId)
    }).toBe(true)
    const message = await (await fetch(`http://127.0.0.1:54334/api/v1/message/${encodeURIComponent(messageId)}`)).json()
    const code = message.HTML.match(/<strong[^>]*>(\d{6,8})<\/strong>/)?.[1]
    expect(Boolean(code)).toBe(true)
    expect((await context.request.post('/api/club/auth/email', { headers: { Origin: target.appUrl }, data: { action: 'verify', email: readerEmail, code } })).status()).toBe(200)
    const session = await (await context.request.get('/api/club?view=session')).json()
    expect(session).toMatchObject({ role: 'developer' })
    const readerId = session.user.id
    await test.step('GM-03 keeps the reopened operation after a closed dialog response arrives', async () => {
      const booking = await fixture.seedLegacy(context, readerId)
      const page = await context.newPage()
      const rosterRead = (url: URL) => url.pathname === '/api/club' && url.searchParams.get('view') === 'staff-game-context'
        && url.searchParams.get('id') === fixture.gameId && url.searchParams.get('operation') === 'roster'
      try {
        await page.goto('/club')
        await page.getByRole('button', { name: 'Game Management', exact: true }).click()
        const opener = page.getByRole('button', { name: /^Actions for QA Court/ })
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          let release = () => {}
          const held = new Promise<void>(resolve => { release = resolve })
          await page.route(rosterRead, async route => {
            const response = await route.fetch()
            await held
            await route.fulfill({ response })
          })
          try {
            const started = page.waitForRequest(request => rosterRead(new URL(request.url())))
            await opener.click()
            await page.getByRole('button', { name: 'Roster & lineups', exact: true }).click()
            await started
            await expect(page.getByRole('dialog', { name: 'Game details', exact: true })).toContainText('Loading game details…')
            await page.keyboard.press('Escape')
            await expect(opener).toBeFocused()
            await opener.click()
            await page.getByRole('button', { name: 'Registrations', exact: true }).click()
            const current = page.getByRole('dialog', { name: 'Game registrations', exact: true })
            await expect(current.getByText('QA Legacy Player', { exact: true })).toBeVisible()
            const late = page.waitForResponse(response => rosterRead(new URL(response.url())))
            release()
            const old = await late
            expect(old.status()).toBe(200)
            await old.finished()
            await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
            await expect(current.getByText('QA Legacy Player', { exact: true })).toBeVisible()
            await expect(page.getByRole('dialog', { name: 'Roster & lineups', exact: true })).toHaveCount(0)
            await info.attach(`GM-context-race-${width}`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
            await page.keyboard.press('Escape')
            await expect(opener).toBeFocused()
          } finally {
            release()
            await page.unroute(rosterRead)
          }
        }
      } finally {
        await page.close()
        sql(`delete from public.roster_entries where booking_id in (select id from public.bookings where id='${booking.id}' and organization_id='${target.organizationId}');
          delete from public.bookings where id='${booking.id}' and organization_id='${target.organizationId}';`)
      }
    })

    // These identities exist only as directory data. The reader uses genuine GoTrue tokens.
    sql(`insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at)
      select id,email,'authenticated','authenticated',now(),now(),now()
      from jsonb_to_recordset($owned$${JSON.stringify(accounts)}$owned$::jsonb) as accounts(id uuid,email text);`)
    await insert('player_profiles', accounts.map(account => ({ organization_id: target.organizationId, user_id: account.id,
      name: 'Synthetic load player', contact: account.email, level: 'intermediate', gender: 'prefer_not_to_say', birth_date: '1995-04-12', first_timer: false })))
    const start = Date.now() + 30 * 86400_000
    const games = Array.from({ length: 5000 }, (_, index) => ({ id: randomUUID(), organization_id: target.organizationId,
      venue_id: fixture.venueId, venue: fixture.venueName, city: 'QA only', status: 'published', team_count: 2, team_price: 165000,
      starts_at: new Date(start + Math.floor(index / 10) * 3600_000).toISOString(), ends_at: new Date(start + Math.floor(index / 10) * 3600_000 + 7200_000).toISOString() }))
    await insert('games', games)
    await insert('game_positions', games.flatMap(game => ['open', 'opposite', 'middle', 'setter'].map(position => ({ game_id: game.id, position, capacity: 4, price: 30000 }))))
    const checkouts = Array.from({ length: 5000 }, (_, index) => ({ id: randomUUID(), organization_id: target.organizationId,
      user_id: accounts[index % accounts.length].id, request_id: randomUUID(), request_fingerprint: 'a'.repeat(64),
      organizer_name: 'Synthetic checkout payment', contact: accounts[index % accounts.length].email, organizer_email: accounts[index % accounts.length].email,
      amount: 60000, status: 'reserved', payment_status: 'approved', expires_at: new Date(start).toISOString(), created_at: new Date(start - Math.floor(index / 10) * 1000).toISOString() }))
    await insert('checkouts', checkouts)
    const payments = Array.from({ length: 5000 }, (_, index) => ({ id: randomUUID(), organization_id: target.organizationId,
      game_id: games[index].id, user_id: accounts[index % accounts.length].id, captain_name: 'Synthetic legacy payment',
      contact: accounts[index % accounts.length].email, kind: 'individual', manual: true, status: 'reserved', payment_status: 'pending', amount: 30000,
      created_at: new Date(start - Math.floor(index / 10) * 1000).toISOString() }))
    await insert('bookings', [...payments, ...checkouts.flatMap((checkout, index) => [0, 1].map(offset => ({ ...payments[index],
      id: randomUUID(), checkout_id: checkout.id, game_id: games[(index + offset) % games.length].id, manual: false, payment_status: 'approved' })))])
    sql('analyze public.games; analyze public.game_positions; analyze public.bookings; analyze public.checkouts; analyze public.player_profiles; analyze auth.users;')
    const scenarios: { name: string; params: Record<string, string> }[] = [
      { name: 'users', params: { view: 'management-users' } },
      { name: 'payments', params: { view: 'management-payments' } },
      { name: 'games', params: { view: 'staff-games' } },
      { name: 'users-filtered', params: { view: 'management-users', query: 'Synthetic load', role: 'player' } },
      { name: 'payments-filtered', params: { view: 'management-payments', query: 'Synthetic', status: 'missing' } },
      { name: 'games-filtered', params: { view: 'staff-games', venueId: fixture.venueId, status: 'published', sort: 'desc' } },
    ]
    const measurements: { name: string; milliseconds: number }[] = []
    for (const scenario of scenarios) {
      const warm = await context.request.get('/api/club', { params: scenario.params })
      expect(warm.status()).toBe(200)
      const first = await warm.json()
      expect(first.rows).toHaveLength(25)
      expect(first.next_cursor).toBeTruthy()
      const continuationKey = scenario.name.startsWith('users') ? 'cursor' : 'after'
      for (let sample = 0; sample < 5; sample++) {
        await Promise.all([{}, { [continuationKey]: first.next_cursor }].map(async continuation => {
          const started = performance.now()
          const response = await context.request.get('/api/club', { params: { ...scenario.params, ...continuation } })
          expect(response.status()).toBe(200)
          expect((await response.json()).rows).toHaveLength(25)
          measurements.push({ name: scenario.name, milliseconds: Math.round((performance.now() - started) * 100) / 100 })
        }))
      }
    }
    // Explain the actual read expressions, including joins and projections, from the applied draft chain.
    const replacements: Record<string, string> = {
      p_org: `'${target.organizationId}'::uuid`, p_user: `'${readerId}'::uuid`, p_limit: '25',
      p_query: "''::text", p_role: "''::text", p_after: 'null::text', p_status: 'null::text', p_game: 'null::uuid',
      p_after_time: 'null::timestamptz', p_after_id: 'null::uuid', p_after_kind: 'null::text',
      p_from: 'null::timestamptz', p_to: 'null::timestamptz', p_anchor: 'now()', p_desc: 'false', p_venue: "''::text",
    }
    const plans: string[] = []
    for (const [name, file] of [['users', 'm6_management_skill.sql'], ['games', 'm6_game_management.sql'], ['payments', 'm6_management_payments.sql']]) {
      const source = readFileSync(`supabase/drafts/${file}`, 'utf8')
      const expression = name === 'payments'
        ? source.slice(source.indexOf('with candidates as'), source.indexOf('return result;')).replace(' into result;', ';')
        : source.match(/return \(([\s\S]*?)\);\s*end;/)?.[1]
      if (!expression) throw new Error('Applied read expression was not found')
      const statement = expression.replace(/\bstaff_role\b/g, "'developer'::text").replace(/\bp_[a-z_]+\b/g, parameter => {
        if (!(parameter in replacements)) throw new Error('Unbound read parameter')
        return replacements[parameter]
      }).replace(/;\s*$/, '')
      plans.push(name + '\n' + sql(`explain (analyze,buffers) ${statement};`))
    }
    await info.attach('bounded-query-plans', { body: plans.join('\n\n'), contentType: 'text/plain' })
    await info.attach('read-workload-results', { body: JSON.stringify({ dataset: { registeredProfiles: 1000, games: 5000, payments: 10000, legacyPayments: 5000, combinedPayments: 5000, bookingLines: 15000, extraAuthFixtureAccounts: 2, extraGame: 1 }, concurrency: 2, budgetMs: 1000, environment: 'isolated local Next development server, warmed routes', measurements }, null, 2), contentType: 'application/json' })
    expect(measurements.every(sample => sample.milliseconds < 1000)).toBe(true)
    const contextResponse = await context.request.get('/api/club', { params: { view: 'staff-game-context', id: games[0].id, operation: 'payments' } })
    expect(contextResponse.status()).toBe(200)
    const scoped = await contextResponse.json()
    expect(scoped.games).toHaveLength(101)
    expect(scoped.games[0].id).toBe(games[0].id)
    expect(scoped.limited_options).toBe(true)
    expect(scoped.bookings.every((booking: { game_id: string }) => booking.game_id === games[0].id)).toBe(true)
    sql(`update public.bookings set game_id='${games[0].id}' where id in
      (select id from public.bookings where organization_id='${target.organizationId}' and checkout_id is null order by id limit 1001);`)
    for (const operation of ['payments', 'registrations']) {
      const bounded = await context.request.get('/api/club', { params: { view: 'staff-game-context', id: games[0].id, operation } })
      expect(bounded.status()).toBe(409)
      expect((await bounded.json()).error).toContain('This game has too many')
    }
    await info.attach('game-context-growth-boundaries', { body: 'PASS: selected-game payments stay scoped, destination options bound to 100 with limited_options=true, and payment/registration histories over 1000 return the documented narrowing fallback.', contentType: 'text/plain' })

  } finally {
    await context.close()
    try {
      // Large datasets exceed the small fixture's PostgREST page and URL bounds.
      // Delete relational children by the exact owned organization before its normal teardown.
      if (prepared) sql(`begin;
        do $$ begin if not exists(select 1 from public.organizations where id='${target.organizationId}' and name='DVC M1 owned fixture ${target.runId}') then raise exception 'Workload ownership changed'; end if; end $$;
        delete from public.booking_confirmation_outbox where organization_id='${target.organizationId}';
        delete from public.roster_entries where booking_id in (select id from public.bookings where organization_id='${target.organizationId}');
        delete from public.bookings where organization_id='${target.organizationId}';
        delete from public.checkouts where organization_id='${target.organizationId}';
        delete from public.game_positions where game_id in (select id from public.games where organization_id='${target.organizationId}');
        delete from public.games where organization_id='${target.organizationId}';
        commit;`)
      await fixture.dispose()
      for (const table of ['organizations', 'games', 'bookings', 'checkouts', 'player_profiles']) {
        const column = table === 'organizations' ? 'id' : 'organization_id'
        expect(sql(`select count(*) from public.${table} where ${column}='${target.organizationId}';`)).toBe('0')
      }
    }
    finally {
      sql(`delete from auth.users where id in (${accountIds}) and email like 'load-%-${target.runId}@example.test';`)
      expect(sql(`select count(*) from auth.users where id in (${accountIds});`)).toBe('0')
      if (readerAttempted) {
        sql(`delete from auth.users where email='${readerEmail}';`)
        expect(sql(`select count(*) from auth.users where email='${readerEmail}';`)).toBe('0')
      }
    }
  }
})
