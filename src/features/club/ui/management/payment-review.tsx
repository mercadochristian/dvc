'use client'
import { RequiredLabel } from '../shared/required'
import { VenueLink } from '../shared/venue-link'
import { useState, type FormEvent } from 'react'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import { PAYMENT_LABEL, paymentState } from '@/features/club/model/collections'
import { upload } from '@/features/club/api/client'
import { type Booking, type ClubGame, type PaymentMethod } from '@/features/club/model/types'
import { ErrorNotice, Modal, Warning } from '../shared/primitives'
import { RecordStatus } from '../shared/collection'
type Save = (action: string, data: unknown) => Promise<boolean | void>
export function PaymentReview({ booking, games, methods, busy, action, transfer, saved, actionError, showCheckoutReceipt = true }: {
  booking: Booking; games: Pick<ClubGame, "id" | "venue" | "maps_url" | "starts_at">[]; methods: PaymentMethod[]; busy: boolean
  action: Save; actionError?: unknown; transfer?: () => void; saved: () => void; showCheckoutReceipt?: boolean
}) {
  const [decision, setDecision] = useState<'approve' | 'reject' | 'cancel' | null>(null)
  const [methodId, setMethodId] = useState('')
  const enabledMethods = methods.filter(method => method.enabled)
  const selectedMethod = enabledMethods.find(method => method.id === methodId) ?? enabledMethods[0]
  const status = paymentState(booking)
  const [error, setError] = useState<unknown>(null), [uploading, setUploading] = useState(false)
  const game = games.find(game => game.id === booking.game_id)
  const checkoutReceipt = showCheckoutReceipt && booking.checkout_id && booking.payment_status === 'approved' ? booking.checkout_id : null
  const legacyReceipt = !booking.checkout_id && booking.receipt
  const canTransfer = booking.status === 'reserved' && (!booking.checkout_id || booking.payment_status === 'approved')
  const registrationLabel = { individual: 'Individual', group: 'Group registration', team: 'Team registration' }[booking.kind]
  async function receipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    data.set('kind', 'receipt'); data.set('booking', booking.id)
    setUploading(true); setError(null)
    try { await upload(data); saved() } catch (error) { setError(error) } finally { setUploading(false) }
  }
  return <article className="club-panel club-payment-review">
    <header className="club-payment-heading"><div><h2>{booking.captain_name}</h2><p><VenueLink name={game?.venue || 'Venue'} mapsUrl={game?.maps_url} /> · {registrationLabel}</p></div><strong>{money(booking.amount)}</strong></header>
    <div className="club-payment-meta"><p>{booking.contact}</p><RecordStatus value={status} label={PAYMENT_LABEL[status]} /></div>
    <small className="club-note club-booking-reference">Booking ID: <code>{booking.id}</code></small>
    <ErrorNotice error={error} />
    <div className="club-actions club-receipt-actions">
      {checkoutReceipt && <a className="club-button" href={`/api/club/asset?kind=checkout_receipt&id=${checkoutReceipt}`} target="_blank" rel="noopener noreferrer">View checkout receipt</a>}
      {legacyReceipt && <a className="club-button" href={`/api/club/asset?kind=receipt&id=${booking.id}`} target="_blank" rel="noreferrer">View receipt</a>}
      {legacyReceipt && booking.payment_status === 'pending' && <>
        <button className="club-button primary" disabled={busy} onClick={() => setDecision('approve')}>Approve</button>
        <button className="club-button danger" disabled={busy} onClick={() => setDecision('reject')}>Reject</button>
      </>}
    </div>
    {checkoutReceipt && <p className="club-note">This receipt covers the whole checkout. The amount shown here is for this game.</p>}
    {booking.manual && !booking.checkout_id && !legacyReceipt && <form className="club-form club-manual-receipt" onSubmit={receipt}>
      <label><RequiredLabel>Payment method</RequiredLabel>
        <select name="method" required value={selectedMethod?.id ?? ''} onChange={event => setMethodId(event.target.value)}>
          {enabledMethods.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}
        </select>
        {selectedMethod && <small className="club-selected-option" aria-hidden="true">{selectedMethod.label}</small>}
      </label>
      <label><RequiredLabel>Receipt</RequiredLabel><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required /></label>
      <button className="club-button" disabled={uploading || !selectedMethod}>{uploading ? 'Uploading…' : 'Add receipt'}</button>
    </form>}
    <footer className="club-actions club-booking-actions">
      {canTransfer && transfer && <button className="club-button" disabled={busy} onClick={transfer}>Transfer</button>}
      <button className="club-button danger" disabled={busy} onClick={() => setDecision('cancel')}>Cancel booking</button>
    </footer>
    {decision && <Modal title={decision === 'approve' ? 'Approve receipt' : decision === 'reject' ? 'Reject receipt' : 'Cancel booking'} close={() => setDecision(null)} dismissible={!busy}><ErrorNotice error={actionError} /><form className="club-form" onSubmit={event => { event.preventDefault(); const note = new FormData(event.currentTarget).get('note'); void action(decision === 'cancel' ? 'booking.cancel' : `receipt.${decision}`, { id: booking.id, ...(decision === 'reject' ? { note } : {}) }).then(ok => { if (ok !== false) setDecision(null) }) }}><div className="club-confirm-summary"><strong>{booking.captain_name}</strong><span><VenueLink name={game?.venue || 'Venue'} mapsUrl={game?.maps_url}/>{game && ` · ${dateLabel(game.starts_at)} · ${timeLabel(game.starts_at)}`}</span><span>{registrationLabel} · {money(booking.amount)}</span></div>{decision !== 'approve' && <Warning>This releases the reserved positions. Handle any refund separately.{booking.checkout_id && ' Other games and the original payment record stay in the checkout.'}</Warning>}{decision === 'reject' && <label><RequiredLabel>Reason</RequiredLabel><textarea name="note" required minLength={3} maxLength={300} /></label>}<button className={`club-button ${decision === 'approve' ? 'primary' : 'danger'}`} disabled={busy}>{decision === 'approve' ? 'Approve receipt' : decision === 'reject' ? 'Reject receipt' : 'Cancel booking'}</button></form></Modal>}
  </article>
}
