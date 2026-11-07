import { execFileSync } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { artifactDirectory } from '../../scripts/e2e/target-guard.mjs'
import { confirmedHold, expect, individual, receiptBytes, test } from './helpers/checkout-harness'

test('guest booking email link opens on another device and attaches only to the matching verified account', async ({ browser, context, owned }) => {
  const appUrl = owned.target.appUrl
  expect((await owned.bootstrap(context)).ok()).toBe(true)
  const second = await owned.createBrowseGame('Annex Court', owned.startsAt, owned.endsAt)
  const { checkout, draft } = await confirmedHold(owned, context, owned.draft([
    individual(owned, owned.gameId), individual(owned, second.id),
  ]))
  expect((await owned.uploadCheckout(context, checkout.id)).ok()).toBe(true)
  expect((await owned.uploadCheckout(context, checkout.id)).ok()).toBe(true)

  const checkoutFilter = { id: `eq.${checkout.id}` }
  const [before] = await owned.rows('checkouts', checkoutFilter)
  const messages = await owned.rows('booking_confirmation_outbox', { organization_id: `eq.${owned.target.organizationId}` })
  expect(messages, 'One guest organizer confirmation from the guest_booking_links SQL draft').toHaveLength(1)
  const [message] = messages
  expect(message.recipient).toBe(owned.email)
  expect(message.payload).toMatchObject({ checkout_reference: checkout.id, games: expect.arrayContaining([
    expect.objectContaining({ id: owned.gameId }),
    expect.objectContaining({ id: second.id }),
  ]) })

  const emailPath = join(artifactDirectory(), owned.target.runId, 'local-mail', `${message.id}.html`)
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/e2e/render-booking-email.mjs', String(message.id)], {
    env: { ...process.env, DVC_BOOKING_EMAIL_LOCAL_ORIGIN: appUrl },
    stdio: 'pipe',
  })
  const email = await readFile(emailPath, 'utf8').finally(() => unlink(emailPath))
  const phone = await browser.newContext({ baseURL: appUrl, viewport: { width: 390, height: 844 } })
  const other = await browser.newContext({ baseURL: appUrl })
  try {
    const page = await phone.newPage()
    await page.setContent(email)
    const open = page.getByRole('link', { name: 'Open my booking', exact: true })
    const link = await open.getAttribute('href')
    if (!link) throw new Error('Local confirmation email is missing its booking link')

    await test.step('A fresh device sees the schedules without the guest cookie', async () => {
      expect((await phone.cookies()).some(cookie => cookie.name === 'dvc-guest')).toBe(false)
      await open.click()
      await expect(page.getByRole('link', { name: 'Sign in to save this booking' })).toBeVisible()
      const games = page.getByRole('list', { name: 'Games in this checkout' })
      await expect(games.getByRole('listitem')).toHaveCount(2)
      await expect(games).toContainText(owned.venueName)
      await expect(games).toContainText(second.venue)
      await expect(page.getByRole('link', { name: 'View submitted receipt' })).toHaveCount(0)
      expect(new URL(page.url()).hash).toBe('')
    })

    await test.step('A different verified email cannot attach or access the receipt', async () => {
      await owned.signIn(other, true)
      const wrongPage = await other.newPage()
      await wrongPage.goto(link)
      await expect(wrongPage.getByRole('button', { name: 'Use another account' })).toBeVisible()
      expect((await owned.rows('checkouts', checkoutFilter))[0]).toMatchObject({ user_id: null, guest_hash: before.guest_hash })
      const receipt = await other.request.get(`/api/club/asset?kind=checkout_receipt&id=${checkout.id}`)
      expect(receipt.ok()).toBe(false)
      await wrongPage.close()
    })

    await test.step('Matching verified sign-in attaches the original checkout and both games', async () => {
      // The local harness uses genuine Supabase password Auth. The Google UI
      // callback requires a configured provider and is outside local coverage.
      const account = await owned.signIn(phone)
      await page.reload()
      await expect(page.getByText('Booking saved to your account.')).toBeVisible()
      await page.getByRole('link', { name: 'Open My bookings' }).click()
      const card = page.getByRole('article').filter({ hasText: checkout.id })
      await expect(card).toContainText('Payment approved')
      await expect(card).toContainText('+1 game')
      expect((await owned.rows('checkouts', checkoutFilter))[0]).toMatchObject({
        id: checkout.id, user_id: account, guest_hash: null, expires_at: before.expires_at,
        payment_status: before.payment_status, amount: before.amount,
      })
      const games = await owned.rows('bookings', { checkout_id: `eq.${checkout.id}` })
      expect(games.map(row => row.id).sort()).toEqual(checkout.bookings.map(row => row.id).sort())
      expect(games.every(row => row.user_id === account && row.guest_hash === null)).toBe(true)
      const path = `/api/club/asset?kind=checkout_receipt&id=${checkout.id}`
      const receipt = await phone.request.get(path)
      expect(receipt.ok()).toBe(true)
      expect((await receipt.body()).equals(receiptBytes)).toBe(true)
      expect((await context.request.get(path)).ok()).toBe(false)
      expect((await owned.hold(context, draft)).status()).toBe(409)
    })

    await test.step('A consumed link cannot restore guest access', async () => {
      await other.clearCookies()
      const replayPage = await other.newPage()
      await replayPage.goto(link)
      await expect(replayPage.getByText(/This link has expired or is no longer available/)).toBeVisible()
    })
  } finally {
    await phone.close()
    await other.close()
  }
})
