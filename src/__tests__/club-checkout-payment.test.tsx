import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CheckoutPayment, checkoutPaymentDisplay } from '@/features/club/ui/registration/checkout-payment'
import { CheckoutBookingCard, bookingDisplayStatus, checkoutBookingGroups, matchesBookingFilter } from '@/features/club/ui/games/checkout-bookings'
import type { Booking, Checkout, PaymentMethod } from '@/features/club/model/types'

const now = Date.parse('2030-01-01T10:07:30Z'), expires = '2030-01-01T10:10:00Z'
const id = '33333333-3333-4333-8333-333333333333'
const base: Booking = { id: 'a', game_id: 'game-a', checkout_id: id, checkout_amount: 165000, checkout_status: 'holding', checkout_payment_status: 'pending', checkout_expires_at: expires, kind: 'group', captain_name: 'Ana', amount: 30000, status: 'holding', payment_status: 'pending', expires_at: expires, created_at: '2030-01-01T10:00:00Z', venue: 'QA Court', starts_at: '2030-01-05T10:00:00Z', ends_at: '2030-01-05T12:00:00Z', entries: [{ id: 'player', name: 'Ana', position: 'open', team: null }] }
const checkout: Checkout = { request_id: id, id, amount: 165000, status: 'holding', payment_status: 'pending', expires_at: expires, created_at: base.created_at, bookings: [base, { ...base, id: 'b', game_id: 'game-b', amount: 45000, status: 'holding' }] }
const cancelledChild: Checkout = { ...checkout, bookings: [base, { ...checkout.bookings[1], status: 'cancelled' }] }
const noop = () => undefined
const method: PaymentMethod = { id: 'method-a', label: 'QA method', account_name: 'Synthetic account', account_number: '0000', qr_path: null, enabled: true }
const methods = [method, { ...method, id: 'method-b', label: 'Other QA method' }]
function payment(value = checkout, extra = {}) { return renderToStaticMarkup(<CheckoutPayment checkout={value} methods={methods} method={method.id} setMethod={noop} now={now} busy={false} uncertain={false} checking={false} submit={noop} check={noop} done={noop} {...extra} />) }

describe('combined checkout payment presentation', () => {
  it('keeps payment field markers alongside their labels above the controls', () => {
    const html = payment()
    for (const name of ['Pay to', 'Receipt']) expect(html).toContain(`<span class="club-field-label">${name}<span class="club-required" aria-hidden="true"> *</span></span>`)
  })
  it('shows a single payment destination as text and keeps the receipt form usable', () => {
    const html = payment(checkout, { methods: [method] })
    expect(html).toContain('Pay to QA method')
    expect(html).not.toContain('<select')
    expect(html).toContain('type="file"')
  })
  it('puts payment before the expandable game breakdown', () => {
    const html = payment()
    expect(html.indexOf('type="file"')).toBeLessThan(html.indexOf('Games in this checkout (2)'))
  })
  it('does not offer an upload when no payment destination is available', () => {
    const html = payment(checkout, { methods: [], method: '', methodsStatus: <p>Loading payment methods…</p> })
    expect(html).toContain('Loading payment methods…')
    expect(html).not.toContain('type="file"')
  })
  it('uses the immutable server checkout amount rather than summing active children', () => expect(payment()).toContain('₱1,650'))
  it('shows the original shared expiry after reopening', () => expect(payment()).toContain('Held for 2:30'))
  it('offers exactly one receipt input for multiple game bookings', () => expect(payment().match(/type="file"/g)).toHaveLength(1))
  it('never describes new checkout receipts as awaiting manual approval', () => expect(payment()).not.toContain('Admin will review'))
  it('disables resubmission while receipt status is unknown', () => expect(payment(checkout, { uncertain: true })).toMatch(/<fieldset[^>]*disabled=""/))
  it('offers status recovery when the upload outcome is uncertain', () => expect(payment(checkout, { uncertain: true })).toContain('Check reservation status'))
  it('does not offer a new receipt after original expiry', () => expect(payment(checkout, { now: Date.parse('2030-01-01T10:11:00Z') })).not.toContain('type="file"'))
  it('shows actual automatic approval only for a reserved approved checkout', () => expect(payment({ ...checkout, status: 'reserved', payment_status: 'approved' })).toContain('Reserved · Payment approved'))
  it('names cancelled and expired checkouts separately from active payment', () => {
    expect(checkoutPaymentDisplay(checkout, now).title).toBe('Payment')
    expect(checkoutPaymentDisplay(checkout, Date.parse(expires)).title).toBe('Hold expired')
    expect(checkoutPaymentDisplay({ ...checkout, status: 'cancelled' }, now).title).toBe('Checkout cancelled')
    expect(checkoutPaymentDisplay(cancelledChild, now).title).toBe('Payment unavailable')
  })
  it('keeps cancelled child history visible without offering an unusable receipt upload', () => {
    const html = payment(cancelledChild)
    expect(html).toContain('A game in this checkout was cancelled.')
    expect(html).toContain('original timer')
    expect(html).not.toContain('type="file"')
  })
})

describe('grouped My bookings metadata', () => {
  it('groups related bookings under one checkout', () => expect(checkoutBookingGroups(checkout.bookings)).toHaveLength(1))
  it('excludes legacy bookings from new checkout groups', () => expect(checkoutBookingGroups([{ ...base, checkout_id: null }])).toEqual([]))
  it('preserves the accepted amount even when a child is cancelled', () => expect(checkoutBookingGroups(cancelledChild.bookings)[0].amount).toBe(165000))
  it('does not fabricate a total when metadata is missing', () => expect(checkoutBookingGroups([{ ...base, checkout_amount: undefined }])[0].amount).toBeNull())
  it('does not silently choose inconsistent totals from different children', () => expect(checkoutBookingGroups([base, { ...base, id: 'b', checkout_amount: 999 }])[0].amount).toBeNull())
  it('retains a valid zero-total checkout', () => expect(checkoutBookingGroups([{ ...base, checkout_amount: 0 }])[0].amount).toBe(0))
  it('puts the single-game player editor before the details disclosure', () => {
    const group = checkoutBookingGroups([base])[0]
    const html = renderToStaticMarkup(<CheckoutBookingCard group={group} now={now} open={noop} editPlayers={noop} />)
    const editor = html.indexOf('data-booking-player-edit=')
    expect(editor).toBeGreaterThan(-1)
    expect(editor).toBeLessThan(html.indexOf('<details'))
    expect(html.match(/data-booking-player-edit=/g)).toHaveLength(1)
  })
  it('offers one shared Continue payment action', () => { const group = checkoutBookingGroups(checkout.bookings)[0]; expect(renderToStaticMarkup(<CheckoutBookingCard group={group} now={now} open={noop} />).match(/Continue to payment/g)).toHaveLength(1) })
})

describe('My bookings filtering', () => {
  it('moves an elapsed hold into Expired at the original deadline', () => {
    expect(bookingDisplayStatus('holding', expires, Date.parse(expires) - 1)).toBe('holding')
    expect(bookingDisplayStatus('holding', expires, Date.parse(expires))).toBe('expired')
  })

  it('matches any venue in a checkout without ignoring the selected status', () => {
    const bookings = [base, { ...base, venue: 'Annex Court' }]
    expect(matchesBookingFilter('reserved', bookings, 'reserved', 'Annex Court')).toBe(true)
    expect(matchesBookingFilter('expired', bookings, 'reserved', 'Annex Court')).toBe(false)
  })
})
