import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { expect, test, individual, confirmedHold } from './helpers/checkout-harness'
import { filterByGameDate } from './helpers/game-filters'
import { preflight } from '../../scripts/e2e/target-guard.mjs'

test('M7 announcements respect revisions and schedules, discounts preserve accepted prices', async ({ owned, browser }, info) => {
  const { appUrl, supabaseUrl, organizationId, serviceRoleKey } = owned.target
  const inbox = 'http://127.0.0.1:' + (Number(new URL(supabaseUrl).port) + 3)
  const inboxContainer = 'supabase_inbucket_' + owned.target.projectId
  const ports = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', inboxContainer], { encoding: 'utf8' }))
  expect(ports['8025/tcp']).toContainEqual({ HostIp: '127.0.0.1', HostPort: new URL(inbox).port })
  const smtp = execFileSync('docker', ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', owned.target.containers.auth], { encoding: 'utf8' }).split('\n')
  expect(smtp.includes('GOTRUE_SMTP_HOST=' + inboxContainer)).toBe(true)
  expect(smtp.includes('GOTRUE_MAILER_AUTOCONFIRM=false')).toBe(true)
  const email = 'dvc-m7-staff-' + randomUUID() + '@example.com'
  const password = randomUUID()
  const context = await browser.newContext({ baseURL: appUrl, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  const write = (action: string, data: object) =>
    context.request.post('/api/club', { headers: { Origin: appUrl }, data: { action, data } })
  const emailAction = (action: string, data: object) =>
    context.request.post('/api/club/auth/email', { headers: { Origin: appUrl }, data: { action, email, ...data } })
  async function messages() {
    const response = await fetch(inbox + '/api/v1/search?query=' + encodeURIComponent('to:' + email))
    expect(response.status).toBe(200)
    return ((await response.json()).messages ?? []).filter((m: {To: {Address: string}[]}) => m.To.some(t => t.Address === email))
  }
  async function service(path: string, method: string, body?: object) {
    preflight()
    const response = await fetch(supabaseUrl + '/' + path, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { apikey: serviceRoleKey, Authorization: 'Bearer ' + serviceRoleKey, 'Content-Type': 'application/json' },
    })
    expect(response.ok, 'Exact owned fixture service request').toBe(true)
  }
  let userId: string | undefined
  let whitelistId: string | undefined
  try {
    expect((await emailAction('sign-up', { password })).status()).toBe(200)
    await expect.poll(async () => (await messages()).length).toBe(1)
    const [message] = await messages()
    const mail = await (await fetch(inbox + '/api/v1/message/' + message.ID)).json()
    const code = mail.HTML.match(/>\s*(\d{6,8})\s*</)?.[1]
    expect(Boolean(code)).toBe(true)
    expect((await emailAction('verify', { code })).status()).toBe(200)
    userId = (await (await context.request.get('/api/club?view=session')).json()).user?.id
    expect(userId).toMatch(/^[a-f0-9-]{36}$/)

    whitelistId = randomUUID()
    await service('rest/v1/staff_email_whitelist', 'POST', { id: whitelistId, organization_id: organizationId, email, role: 'developer', enabled: true })
    expect((await (await context.request.get('/api/club?view=session')).json()).role).toBe('developer')

    const guest = await browser.newContext({baseURL:appUrl,viewport:{width:390,height:844}})
    try {
      const player = await guest.newPage()
      const title = 'Synthetic weekend volleyball notice'
      const now = Date.now()
      const announcement = { title, body:'Courts open as scheduled.', enabled:true,
        publish_at:new Date(now-60_000).toISOString(),ends_at:new Date(now+600_000).toISOString() }
      const saved = await write('announcement.save',announcement)
      expect(saved.status()).toBe(200)
      const { id } = await saved.json()
      const banner = player.getByRole('complementary',{name:'Announcement: '+title})
      await player.goto('/club')
      await expect(banner).toBeVisible()
      await banner.getByRole('button',{name:'Dismiss '+title,exact:true}).click()
      await expect(banner).toHaveCount(0)
      const reloadWithFeed = async () => {
        const response = player.waitForResponse(r=>new URL(r.url()).searchParams.get('view')==='announcements' && r.ok())
        await player.reload()
        await response
      }
      await reloadWithFeed()
      await expect(banner).toHaveCount(0)
      expect((await write('announcement.save',{...announcement,id,body:'Court 2 is open for warmup.'})).status()).toBe(200)
      await reloadWithFeed()
      await expect(banner).toContainText('Court 2 is open for warmup.')
      await info.attach('M7 public announcement mobile after revision',{body:await banner.screenshot({animations:'disabled'}),contentType:'image/png'})
      const feed = async () => (await guest.request.get('/api/club?view=announcements')).json()
      expect((await write('announcement.save',{...announcement,id,publish_at:new Date(now+120_000).toISOString()})).status()).toBe(200)
      expect(await feed()).toEqual([])
      expect((await write('announcement.save',{...announcement,id,publish_at:new Date(now-120_000).toISOString(),ends_at:new Date(now-60_000).toISOString()})).status()).toBe(200)
      expect(await feed()).toEqual([])
      expect((await write('announcement.save',{...announcement,id,enabled:false})).status()).toBe(200)
      expect(await feed()).toEqual([])
      await reloadWithFeed()
      await expect(banner).toHaveCount(0)

      expect((await owned.bootstrap(guest)).status()).toBe(200)
      const original=(await confirmedHold(owned,guest,owned.draft([individual(owned,owned.gameId)]))).checkout
      expect((await owned.uploadCheckout(guest,original.id)).status()).toBe(200)
      const baseline=await owned.rows('bookings',{id:'eq.'+original.bookings[0].id},'amount,payment_status')
      expect(baseline).toEqual([{amount:30000,payment_status:'approved'}])
      const game = { id:owned.gameId, venue_id:owned.venueId,starts_at:owned.startsAt,ends_at:owned.endsAt,status:'published',
        team_count:2,team_price:165000,team_discount_price:150000,
        positions:{open:{capacity:4,price:30000,discount_price:26000},middle:{capacity:4,price:30000},opposite:{capacity:2,price:30000},setter:{capacity:2,price:25000}}}
      expect((await write('game.save',game)).status()).toBe(200)
      const selected=await guest.request.get('/api/club?view=selected-games&ids='+owned.gameId)
      expect(selected.status()).toBe(200)
      const [gameView]=(await selected.json()).games
      expect(gameView).toMatchObject({regular_team_price:165000,team_price:150000,positions:expect.arrayContaining([expect.objectContaining({position:'open',regular_price:30000,price:26000})])})
      await player.reload()
      await filterByGameDate(player, owned.gameDate)
      const card = player.getByRole('article').filter({ has: player.getByRole('heading', { name: owned.venueName, exact: true }) })
      await expect(card.getByLabel('Regular price ₱300', { exact: true })).toBeVisible()
      await expect(card.getByLabel('Regular price ₱1,650', { exact: true })).toBeVisible()
      await expect(card).toContainText('₱260')
      await expect(card).toContainText('₱1,500')
      const discounted=(await confirmedHold(owned,guest,owned.draft([individual(owned,owned.gameId)]))).checkout
      expect(discounted.amount).toBe(26000)
      const team={game_id:owned.gameId,kind:'team' as const,organizer_plays:true,players:[owned.player('open','QA Organizer'),...(['open','middle','middle','opposite','setter'] as const).map(pos=>owned.player(pos,null,false))]}
      const discountedTeam=(await confirmedHold(owned,guest,owned.draft([team]))).checkout
      expect(discountedTeam.amount).toBe(150000)
      expect((await owned.uploadCheckout(guest,discountedTeam.id)).status()).toBe(200)
      expect(await owned.rows('bookings',{id:'eq.'+discountedTeam.bookings[0].id},'amount,payment_status')).toEqual([{amount:150000,payment_status:'approved'}])
      expect(await owned.rows('bookings',{id:'eq.'+original.bookings[0].id},'amount,payment_status')).toEqual(baseline)
    } finally { await guest.close() }
  } finally {
    await context.close()
    if (whitelistId) await service('rest/v1/staff_email_whitelist?id=eq.' + whitelistId + '&organization_id=eq.' + organizationId, 'DELETE')
    const exactId = userId ?? execFileSync('docker', ['exec', '-i', owned.target.containers.database, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], {
      input: "select id from auth.users where email = '" + email + "';", encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (exactId) {
      await service('rest/v1/club_announcements?organization_id=eq.' + organizationId + '&updated_by=eq.' + exactId, 'DELETE')
      await service('auth/v1/admin/users/' + exactId, 'DELETE')
      const after = await fetch(supabaseUrl + '/auth/v1/admin/users/' + exactId, { headers: { apikey: serviceRoleKey, Authorization: 'Bearer ' + serviceRoleKey } })
      expect(after.status).toBe(404)
    }
    const ids = (await messages()).map((m: {ID: string}) => m.ID)
    if (ids.length) expect((await fetch(inbox + '/api/v1/messages', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ IDs: ids }) })).ok).toBe(true)
    expect(await messages()).toHaveLength(0)
  }
})
