'use client'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import { holdSecondsRemaining } from '@/features/club/model/registration-summary'
import { playerEditBlock } from '@/features/club/model/booking-player-edit'
import { POSITION_LABEL, type Booking } from '@/features/club/model/types'
import { BookingReference } from '../shared/booking-reference'
import { VenueLink } from '../shared/venue-link'

export function checkoutBookingGroups(bookings: Booking[]) {
  const grouped = new Map<string, Booking[]>()
  for (const booking of bookings) {
    if (booking.checkout_id) grouped.set(booking.checkout_id, [...(grouped.get(booking.checkout_id) || []), booking])
  }
  return [...grouped].map(([id, entries]) => {
    const first = entries[0]
    const valid = Number.isSafeInteger(first.checkout_amount) && first.checkout_amount! >= 0 && Boolean(first.checkout_status && first.checkout_payment_status && first.checkout_expires_at && Number.isFinite(Date.parse(first.checkout_expires_at))) && entries.every(entry => entry.checkout_amount === first.checkout_amount && entry.checkout_status === first.checkout_status && entry.checkout_payment_status === first.checkout_payment_status && entry.checkout_expires_at === first.checkout_expires_at)
    return { id, bookings: entries, amount: valid ? first.checkout_amount! : null, status: valid ? first.checkout_status : null, payment_status: valid ? first.checkout_payment_status : null, expires_at: valid ? first.checkout_expires_at : null }
  })
}

export function bookingDisplayStatus(status: string | null | undefined, expiresAt: string | null | undefined, now: number) {
  if (status === 'holding' && expiresAt && holdSecondsRemaining(expiresAt, now) === 0) return 'expired'
  return status || 'unknown'
}

export function matchesBookingFilter(status: string, bookings: Booking[], statusFilter: string, venue: string) {
  if (statusFilter !== 'all' && statusFilter !== status) return false
  return !venue || bookings.some(booking => booking.venue === venue)
}

function bookingSchedule(booking: Booking) {
  if (!booking.starts_at) return 'Schedule unavailable'
  return `${dateLabel(booking.starts_at)} · ${timeLabel(booking.starts_at)}${booking.ends_at ? `–${timeLabel(booking.ends_at)}` : ''}`
}

export function CheckoutBookingCard({ group, now, open, editPlayers }: { group: ReturnType<typeof checkoutBookingGroups>[number]; now: number; open: () => void; editPlayers?: (booking: Booking) => void }) {
  const remaining = group.expires_at ? holdSecondsRemaining(group.expires_at, now) : 0
  const status = bookingDisplayStatus(group.status, group.expires_at, now)
  const canPay = status === 'holding' && remaining > 0
  const first = group.bookings[0]
  const more = group.bookings.length - 1
  const statusLabel = status === 'unknown' ? 'Check status'
    : canPay ? 'Awaiting payment'
    : status === 'reserved' && group.payment_status === 'approved' ? 'Reserved · Payment approved'
    : status === 'reserved' && group.payment_status === 'pending' ? 'Reserved · Payment under review'
    : status[0].toUpperCase() + status.slice(1)
  function playerEditor(booking: Booking) {
    if (!editPlayers || !booking.entries?.length) return null
    const editBlock = playerEditBlock(booking, now)
    return <div className="club-booking-edit">
      <button type="button" className="club-button" data-booking-player-edit={booking.id} disabled={Boolean(editBlock)} onClick={() => editPlayers(booking)}>Edit player details</button>
      {editBlock && <small className="club-note">{editBlock}</small>}
    </div>
  }

  return <article className="club-panel club-checkout-booking">
    <div className="club-booking-overview">
      <div>
        <h2><VenueLink name={first.venue || 'Venue'} mapsUrl={first.maps_url} />{more > 0 && <small> +{more} {more === 1 ? 'game' : 'games'}</small>}</h2>
        <p className="club-note">{bookingSchedule(first)}</p>
      </div>
      <span className="club-badge neutral">{statusLabel}</span>
    </div>
    <div className="club-inline">
      <strong>{group.amount === null ? 'Checkout total unavailable' : money(group.amount)}</strong>
      {canPay && <span className="club-note" role="timer">Hold remaining: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span>}
      <button type="button" data-checkout-resume={group.id} className={`club-button${canPay ? ' primary' : ''}`} onClick={open}>{canPay ? 'Continue to payment' : 'View checkout'}</button>
    </div>
    {more === 0 && playerEditor(first)}
    <details className="club-booking-disclosure">
      <summary>Booking details</summary>
      {group.bookings.map((booking, index) => {
        const gameStatus = bookingDisplayStatus(booking.status, booking.expires_at, now)
        const kind = { team: 'Team registration', group: 'Group registration', individual: 'Individual registration' }[booking.kind]
        return <section className="club-checkout-game" key={booking.id}>
          {index > 0 && <>
            <h3><VenueLink name={booking.venue || 'Venue'} mapsUrl={booking.maps_url} /></h3>
            <p className="club-note">{bookingSchedule(booking)}</p>
          </>}
          <p>{kind}{gameStatus !== status && ` · ${gameStatus}`}</p>
          {(more > 0 || group.amount !== booking.amount) && <strong>{money(booking.amount)}</strong>}
          {Boolean(booking.entries?.length) && <ul className="club-booking-roster" aria-label="Players">
            {booking.entries?.map(entry => <li className="club-entry" key={entry.id}>{entry.name || 'Player to be named'} · {POSITION_LABEL[entry.position]}</li>)}
          </ul>}
          {more > 0 && playerEditor(booking)}
          <BookingReference label="Booking ID" value={booking.id} />
        </section>
      })}
      <BookingReference label="Checkout reference" value={group.id} />
    </details>
  </article>
}
