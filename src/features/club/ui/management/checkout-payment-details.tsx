'use client'

import { useState } from 'react'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import type { CheckoutPaymentRecord } from '@/features/club/model/management-payments'
import type { Booking } from '@/features/club/model/types'
import { CollectionTable, RecordStatus } from '../shared/collection'
import { CursorPagination } from '../shared/cursor-pagination'
import { Empty, ErrorNotice, Modal } from '../shared/primitives'
import { VenueLink } from '../shared/venue-link'
import { PaymentReview } from './payment-review'
import { PAYMENT_PAGE_SIZE, usePaymentPage, usePaymentPaging } from './payment-page'

const CHECKOUT_STATUS = {
  holding: 'Awaiting receipt', expired: 'Expired', cancelled: 'Cancelled', reserved: 'Reserved',
}
type PaymentAction = (action: string, data: unknown) => Promise<boolean | void>

export function CheckoutPaymentDetails({ checkout, userId, refresh, close, busy, action, actionError, transfer, saved, onAccessLost }: {
  checkout: CheckoutPaymentRecord
  userId: string
  refresh: number
  close: () => void
  busy: boolean
  action: PaymentAction
  actionError?: unknown
  transfer?: (booking: Booking, onSaved: () => void) => void
  saved: () => void
  onAccessLost?: () => void
}) {
  const paging = usePaymentPaging()
  const [editingId, setEditingId] = useState<string | null>(null)
  const { page, loading, error, retry, displayedPageNumber } = usePaymentPage<Booking>(userId, new URLSearchParams({
    mode: 'checkout', checkout: checkout.id, after: paging.after,
  }).toString(), refresh, () => { close(); onAccessLost?.() }, true, paging.pageNumber)
  const nextCursor = page?.next_cursor
  const rows = page?.rows ?? []
  const editing = rows.find(booking => booking.id === editingId && booking.status === 'reserved')

  return <Modal title="Checkout payment" close={close} wide>
    <section className="club-panel club-payment-review" aria-label="Checkout summary">
      <header className="club-payment-heading">
        <div><h3>{checkout.organizer}</h3><p>{checkout.contact}</p></div>
        <div className="club-cell-stack"><small>Checkout total</small><strong>{money(checkout.amount)}</strong></div>
      </header>
      <div className="club-payment-meta">
        <small className="club-note club-booking-reference">Checkout ID: <code>{checkout.id}</code></small>
        <RecordStatus value={checkout.payment_status === 'approved' ? 'approved' : checkout.status}
          label={checkout.payment_status === 'approved' ? 'Payment approved' : CHECKOUT_STATUS[checkout.status]} />
      </div>
      {checkout.receipt && <section className="club-confirm-summary" aria-label="Receipt">
        <strong>Payment receipt</strong>
        <span>{checkout.receipt.method} · {dateLabel(checkout.receipt.submitted_at)} · {timeLabel(checkout.receipt.submitted_at)}</span>
        <div className="club-actions"><a className="club-button"
          href={`/api/club/asset?kind=checkout_receipt&id=${checkout.id}`}
          target="_blank" rel="noopener noreferrer">View checkout receipt</a></div>
      </section>}
      <section aria-labelledby="checkout-breakdown">
        <h3 id="checkout-breakdown">Games in this checkout</h3>
        <ErrorNotice error={error} />
        {Boolean(error) && <button type="button" className="club-button" onClick={retry}>Retry game breakdown</button>}
        {loading && !page ? <Empty>Loading game breakdown…</Empty> : page && <CollectionTable
          label="Checkout game breakdown" headings={['Game', 'Registration', 'Amount', 'Actions']} count={rows.length}
          empty="No game bookings were found for this checkout."
          footer={<CursorPagination label="Checkout game pages" pageNumber={displayedPageNumber} pageSize={PAYMENT_PAGE_SIZE}
            rowCount={rows.length} previous={paging.previous} next={nextCursor && !error ? () => paging.next(nextCursor) : undefined}
            loading={loading} />}>
          {rows.map(booking => <tr key={booking.id}>
            <td data-label="Game"><span className="club-cell-stack">
              <VenueLink name={booking.venue || 'Venue'} mapsUrl={booking.maps_url} />
              {booking.starts_at && <small>{dateLabel(booking.starts_at)} · {timeLabel(booking.starts_at)}</small>}
            </span></td>
            <td data-label="Registration"><RecordStatus value={booking.status} /></td>
            <td data-label="Amount" className="club-numeric">{money(booking.amount)}</td>
            <td data-label="Actions">{booking.status === 'reserved' && <button type="button" className="club-button"
              disabled={busy || loading || Boolean(error)} onClick={() => setEditingId(booking.id)}>Manage booking</button>}</td>
          </tr>)}
        </CollectionTable>}
      </section>
    </section>
    {editing && <Modal title="Game booking" close={() => setEditingId(null)}>
      <PaymentReview booking={{ ...editing, contact: checkout.contact }}
        games={editing.starts_at ? [{ id: editing.game_id, venue: editing.venue || 'Venue', starts_at: editing.starts_at, maps_url: editing.maps_url }] : []}
        methods={[]} busy={busy} action={async (name, data) => {
          const result = await action(name, data)
          if (result !== false) setEditingId(null)
          return result
        }} actionError={actionError} transfer={transfer ? () => transfer(editing, () => setEditingId(null)) : undefined}
        saved={saved} showCheckoutReceipt={false} />
    </Modal>}
  </Modal>
}
