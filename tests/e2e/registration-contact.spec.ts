import { test, expect, openRegistration, fillOrganizer, fillPlayer, playerField, activatePlayer, receiptBytes, type Checkout } from './helpers/checkout-harness'

for (const scenario of [
  { name: 'email guest individual', contact: 'individual@example.test', email: 'individual@example.test', width: 390, height: 844, players: 1 },
  { name: 'email guest group with a position-only teammate', contact: 'organizer@example.test', email: 'organizer@example.test', width: 1280, height: 900, players: 2 },
  { name: 'email guest team with an extra player', contact: 'team@example.test', email: 'team@example.test', width: 1280, height: 900, players: 7 },
]) {
  test(`CONTACT ${scenario.name} through receipt upload`, async ({ owned, page }, info) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height })
    await openRegistration(page, owned)
    const dialog = page.getByRole('dialog')
    const capture = (name: string) => page.screenshot({ path: info.outputPath(`${name}.png`) })
    await fillOrganizer(page)
    await fillPlayer(playerField(page))
    await expect(dialog.getByText(/calculated from birthday/)).toHaveCount(0)
    await capture('01-player-details')
    await dialog.getByRole('button', { name: 'Next', exact: true }).click()
    await capture('02-add-player-choice')
    await expect(dialog.getByRole('region', { name: 'Additional player choice' })).toBeVisible()
    await dialog.locator('footer[aria-label="Registration total"]').getByRole('button', { name: scenario.players > 1 ? 'Yes' : 'No', exact: true }).click()
    if (scenario.players > 1) {
      for (let count = 2; count < scenario.players; count++) await dialog.getByRole('button', { name: 'Add another player', exact: true }).click()
      await activatePlayer(page, scenario.players)
      await expect(playerField(page, scenario.players).getByRole('checkbox', { name: 'Player details available' })).not.toBeChecked()
      await capture('03-position-only-teammate')
      await dialog.getByRole('button', { name: 'Continue to contact' }).click()
    }

    const field = dialog.getByLabel('Email', { exact: true })
    const review = dialog.getByRole('button', { name: 'Review registration', exact: true })
    await expect(dialog.getByLabel('Confirmation email', { exact: true })).toHaveCount(0)
    await field.fill('https://m.me/dvc-qa-organizer')
    await review.click()
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await capture('04-invalid-contact')
    await field.fill(scenario.contact)
    await capture('05-contact')
    await review.click()
    await expect(dialog.getByRole('heading', { name: 'Review your registration' })).toBeVisible()
    await expect(dialog).toContainText(scenario.contact)
    expect(await owned.rows('checkouts', { organization_id: `eq.${owned.target.organizationId}` })).toHaveLength(0)
    if (scenario.players === 7) await expect(dialog).toContainText('₱1,650')
    await capture('06-review')

    const hold = page.waitForResponse(response => response.url().endsWith('/api/club') && response.request().postDataJSON()?.action === 'checkout.hold')
    await dialog.getByRole('button', { name: 'Register', exact: true }).click()
    const response = await hold
    expect(response.status()).toBe(200)
    const { checkout } = await response.json() as { checkout: Checkout }
    await expect(dialog.getByRole('timer')).toContainText('original ten-minute expiry')
    const filter = { id: `eq.${checkout.id}` }
    expect((await owned.rows('checkouts', filter))[0]).toMatchObject({ contact: scenario.contact, organizer_email: scenario.email, status: 'holding' })
    await capture('07-hold-and-payment')

    const upload = dialog.locator('input[name="file"]')
    const reserve = dialog.getByRole('button', { name: 'Submit receipt and reserve', exact: true })
    await upload.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not a receipt') })
    await reserve.click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    expect((await owned.rows('checkouts', filter))[0]).toMatchObject({ status: 'holding', expires_at: checkout.expires_at })
    await capture('08-invalid-receipt')
    await upload.setInputFiles({ name: 'synthetic-receipt.png', mimeType: 'image/png', buffer: receiptBytes })
    await reserve.click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: checkout.id })).toContainText('Reserved. Payment approved.')
    await capture('09-confirmation')
    await page.getByRole('button', { name: 'My bookings', exact: true }).click()
    const bookingCard = page.getByRole('article').filter({ hasText: checkout.id })
    await expect(bookingCard).toContainText('Reserved')
    await expect(bookingCard).toContainText('Payment approved')
    await bookingCard.scrollIntoViewIfNeeded()
    await capture('10-my-bookings')
    const bookings = await owned.rows('bookings', { checkout_id: `eq.${checkout.id}` })
    expect(bookings).toHaveLength(1)
    expect(bookings[0]).toMatchObject({ kind: scenario.players >= 6 ? 'team' : scenario.players === 2 ? 'group' : 'individual', contact: scenario.contact, organizer_email: scenario.email, status: 'reserved', payment_status: 'approved' })
    expect((await owned.storedCheckoutReceipt(checkout.id)).bytes.equals(receiptBytes)).toBe(true)
    await page.reload()
    await page.getByRole('button', { name: 'My bookings', exact: true }).click()
    await expect(bookingCard).toContainText('Payment approved')
  })
}
