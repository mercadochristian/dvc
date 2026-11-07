'use client'
import { useId, type FormEvent, type ReactNode } from 'react'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import { holdSecondsRemaining } from '@/features/club/model/registration-summary'
import { POSITION_LABEL, type Checkout, type PaymentMethod } from '@/features/club/model/types'
import { BookingReference } from '../shared/booking-reference'
import { Warning } from '../shared/primitives'
import { RequiredMark, RequiredNote } from '../shared/required'
import { CheckoutProgress } from './checkout-progress'
import styles from './checkout-wizard.module.css'
import { VenueLink } from '../shared/venue-link'

export function checkoutPaymentDisplay(checkout: Checkout, now: number) {
  const remaining = holdSecondsRemaining(checkout.expires_at, now)
  const holding = checkout.status === 'holding' && remaining > 0
  const blockedByCancellation = holding && checkout.bookings.some(booking => booking.status === 'cancelled')
  const confirmed = checkout.status === 'reserved' && checkout.payment_status === 'approved'
  const payable = holding && !blockedByCancellation
  const title = confirmed ? 'Reservation confirmed' : payable ? 'Payment' : blockedByCancellation ? 'Payment unavailable'
    : checkout.status === 'cancelled' ? 'Checkout cancelled' : checkout.status === 'expired' || checkout.status === 'holding' ? 'Hold expired' : 'Checkout status'
  return { remaining, holding, blockedByCancellation, confirmed, payable, title }
}

export function CheckoutPayment({ checkout, methods, method, setMethod, methodsStatus, now, busy, uncertain, checking, submit, check, done }: {
  checkout: Checkout; methods: PaymentMethod[]; method: string; setMethod: (id: string) => void; methodsStatus?: ReactNode; now: number
  busy: boolean; uncertain: boolean; checking: boolean; submit: (event: FormEvent<HTMLFormElement>) => void; check: () => void; done: () => void
}) {
  const receiptHelp = `${useId()}-receipt-help`
  const selected = methods.find(entry => entry.id === method)
  const { remaining, holding, blockedByCancellation, confirmed, payable, title } = checkoutPaymentDisplay(checkout, now)
  const breakdown = <div className="club-checkout-booking-breakdown">{checkout.bookings.map(booking => <section key={booking.id} className={`club-checkout-game ${styles.reviewPanel}`}>
      <header><div><h3><VenueLink name={booking.venue || 'Venue'} mapsUrl={booking.maps_url} /></h3>{booking.starts_at && <p className="club-note">{dateLabel(booking.starts_at)} · {timeLabel(booking.starts_at)}{booking.ends_at && `–${timeLabel(booking.ends_at)}`}</p>}</div><strong>{money(booking.amount)}</strong></header>
      <p>{booking.kind === 'team' ? booking.entries?.length ? `Team · ${booking.entries.length} players` : 'Team registration' : booking.kind === 'group' ? booking.entries?.length ? `Group of ${booking.entries.length}` : 'Group registration' : 'Individual'} · {booking.status}</p>
      {!!booking.entries?.length && <ul className="club-checkout-player-review">{booking.entries.map(player => <li key={player.id}><span>{player.name || 'Player to be named'}<small>{POSITION_LABEL[player.position]}</small></span></li>)}</ul>}
    </section>)}</div>

  return <div className={`club-form club-checkout-payment ${styles.flow}`}>
    {payable && <CheckoutProgress phase="Payment" />}
    <div className={styles.paymentSummary}><div className="club-inline"><span className="club-cell-stack"><small>Total for {checkout.bookings.length} {checkout.bookings.length === 1 ? 'game' : 'games'}</small><strong>{money(checkout.amount)}</strong></span><span className={confirmed ? 'club-badge' : remaining && checkout.status === 'holding' ? 'club-badge neutral' : 'club-badge danger'}>{confirmed ? 'Reserved · Payment approved' : payable ? `Held for ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : title}</span></div>
    {holding && <p className="club-note" role="timer">All games share this original ten-minute expiry. Reopening or retrying payment does not extend it.</p>}
    </div>
    {confirmed ? <><p>Your reservation is confirmed. Keep the checkout reference for your records.</p>{checkout.receipt && <a className="club-button" href={`/api/club/asset?kind=checkout_receipt&id=${checkout.id}`} target="_blank" rel="noopener noreferrer">View submitted receipt</a>}<button type="button" className="club-button primary" onClick={done}>Done</button></> : payable ? <form className={`club-form ${styles.paymentPanel}`} onSubmit={submit}>
      <header className={styles.panelHeader}><h3>Payment receipt</h3>{selected && <RequiredNote />}</header>
      <fieldset className="club-checkout-payment-fields" disabled={busy || uncertain}>
        {methods.length > 1 && <label><span className="club-field-label">Pay to<RequiredMark /></span><select required value={method} onChange={event => setMethod(event.target.value)}>{methods.map(entry => <option value={entry.id} key={entry.id}>{entry.label}</option>)}</select></label>}
        {selected && <div className="club-bank">{methods.length === 1 && <p className="club-note">Pay to {selected.label}</p>}<strong>{selected.account_name}</strong><p>{selected.account_number}</p>{selected.qr_path && <img className="club-qr" width={240} height={240} src={`/api/club/asset?kind=qr&id=${selected.id}`} alt={`${selected.label} payment QR`} />}</div>}
        {selected && <div className="club-field"><label><span className="club-field-label">Receipt<RequiredMark /></span><input aria-label="Receipt" aria-describedby={receiptHelp} name="file" type="file" required accept="image/png,image/jpeg,image/webp" /></label><small id={receiptHelp}>PNG, JPEG or WebP · up to 3 MB</small></div>}
        {selected && <button type="submit" className="club-button primary" disabled={busy}>{busy ? 'Uploading…' : 'Submit receipt and reserve'}</button>}
      </fieldset>
      {methodsStatus}
      {uncertain && <p className="club-note">The upload result is not confirmed yet. Check the reservation status before retrying.</p>}
      <div className="club-actions"><button type="button" className={`club-button${uncertain ? '' : ' quiet'}`}
        disabled={busy || checking} onClick={check}>{checking ? 'Checking…' : 'Check reservation status'}</button></div>
    </form> : <><Warning>{blockedByCancellation ? 'A game in this checkout was cancelled. Any remaining slots are held until the original timer ends. Contact DVC if you already paid.' : checkout.status === 'cancelled' ? 'This checkout was cancelled. Contact the club about any payment already made.' : checkout.status === 'expired' || checkout.status === 'holding' ? 'This hold has expired. Its slots are no longer reserved for payment.' : 'Check the reservation status or contact the club for help with this payment.'}</Warning><button type="button" className="club-button" disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check reservation status'}</button></>}
    {payable && <details className={`club-booking-disclosure ${styles.paymentBreakdown}`}>
      <summary>Games in this checkout ({checkout.bookings.length})</summary>
      {breakdown}
    </details>}
    {!payable && breakdown}
    <BookingReference label="Checkout reference" value={checkout.id} />
  </div>
}
