'use client'

import { useState, type ReactNode } from 'react'
import { PAYMENT_LABEL, paymentState } from '@/features/club/model/collections'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import type { ManagementPayment, PaymentGame } from '@/features/club/model/management-payments'
import type { Booking, PaymentMethod } from '@/features/club/model/types'
import { AppliedFilters } from '../shared/applied-filters'
import { CollectionTable, RecordStatus, SearchField } from '../shared/collection'
import { CursorPagination } from '../shared/cursor-pagination'
import { Empty, ErrorNotice, Modal } from '../shared/primitives'
import { VenueLink } from '../shared/venue-link'
import { CheckoutPaymentDetails } from './checkout-payment-details'
import { PaymentGameFilter } from './payment-game-filter'
import { PAYMENT_PAGE_SIZE, usePaymentPage, usePaymentPaging } from './payment-page'
import { PaymentReview } from './payment-review'

type PaymentAction = (action: string, data: unknown) => Promise<boolean | void>
const REGISTRATION_LABEL = { individual: 'Individual', group: 'Group registration', team: 'Team registration' }

function paymentKey(payment: ManagementPayment) {
  return `${payment.kind}:${payment.id}`
}

function PaymentStatus({ payment }: { payment: ManagementPayment }) {
  if (payment.kind === 'legacy') {
    const status = paymentState(payment.booking)
    return <span className="club-cell-stack">
      <RecordStatus value={status} label={PAYMENT_LABEL[status]} />
      {payment.booking.status !== 'reserved' && <small>Booking {payment.booking.status}</small>}
    </span>
  }
  const status = payment.payment_status === 'approved' ? 'approved' : payment.status
  return <RecordStatus value={status} label={status === 'holding' ? 'Awaiting receipt' : undefined} />
}

export function GlobalPayments({ userId, refresh, busy, action, actionError, methods = [], methodsError, retryMethods, moreMethods, transfer, saved, onAccessLost, active = true }: {
  active?: boolean
  userId: string
  refresh: number
  busy: boolean
  action: PaymentAction
  actionError?: unknown
  methods?: PaymentMethod[]
  methodsError?: unknown
  retryMethods?: () => void
  moreMethods?: ReactNode
  transfer?: (booking: Booking, onSaved: () => void) => void
  saved: () => void
  onAccessLost?: () => void
}) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [gameDate, setGameDate] = useState('')
  const [game, setGame] = useState<PaymentGame | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const paging = usePaymentPaging()
  const close = () => setSelectedKey(null)
  const accessLost = () => { close(); onAccessLost?.() }
  const { page, loading, error, retry, displayedPageNumber } = usePaymentPage<ManagementPayment>(userId, new URLSearchParams({
    query, status, game: game?.id ?? '', after: paging.after,
  }).toString(), refresh, accessLost, active, paging.pageNumber)
  const rows = page?.rows ?? []
  const selected = rows.find(row => paymentKey(row) === selectedKey)
  const nextCursor = page?.next_cursor

  return <>
    <div className="club-section-heading"><h2>Payments</h2></div>
    <p className="club-section-note">One row per checkout. Open Details for receipts and amounts by game.</p>
    <AppliedFilters filters={[
      ...(query ? [{ key: 'query', label: `Search: ${query}`, remove: () => { setSearch(''); setQuery(''); paging.reset() } }] : []),
      ...(status ? [{ key: 'status', label: status === 'missing' ? 'No receipt submitted' : PAYMENT_LABEL[status], remove: () => { setStatus(''); paging.reset() } }] : []),
      ...(game ? [{ key: 'game', label: `Game: ${game.venue} · ${dateLabel(game.starts_at)} ${timeLabel(game.starts_at)}`, remove: () => { setGame(null); setGameDate(''); paging.reset() } }] : []),
    ]}>
      <div className="club-payment-filters club-filter-fields">
      <form className="club-payment-search" role="search" onSubmit={event => {
        event.preventDefault()
        const filter = search.trim()
        if (filter === query && !paging.after) return
        setQuery(filter)
        paging.reset()
      }}>
        <SearchField label="Search payments" placeholder="Name, venue, or ref" value={search}
          change={value => setSearch(value.slice(0, 120))} />
        <button type="submit" className="club-button quiet">Search</button>
      </form>
      <label>Payment status
        <select value={status} onChange={event => { setStatus(event.target.value); paging.reset() }}>
          <option value="">All statuses</option>
          {Object.entries(PAYMENT_LABEL).map(([value, label]) => <option key={value} value={value}>{value === 'missing' ? 'No receipt submitted' : label}</option>)}
        </select>
      </label>
      <label className="club-payment-date">Find a game by date
        <input type="date" value={gameDate} onChange={event => {
          setGameDate(event.target.value)
          if (game) { setGame(null); paging.reset() }
        }} />
      </label>
      {gameDate && <div className="club-payment-game-options"><PaymentGameFilter active={active} key={gameDate} date={gameDate} userId={userId} refresh={refresh}
        selected={game} select={value => { setGame(value); paging.reset() }} onAccessLost={accessLost} /></div>}
      </div>
    </AppliedFilters>
    <ErrorNotice error={error} />
    {Boolean(error) && <div className="club-actions">
      {page && <p className="club-note">Showing the last loaded payments.</p>}
      <button type="button" className="club-button" onClick={retry}>Retry payments</button>
      {paging.after && <button type="button" className="club-button" onClick={paging.reset}>Return to first page</button>}
    </div>}
    {loading && !page ? <Empty>Loading payments…</Empty> : page && <CollectionTable
      label="Payments" headings={['Organizer', 'Payment for', 'Created', 'Amount', 'Status', 'Actions']}
      count={rows.length} empty="No payments match these filters."
      footer={<CursorPagination label="Payment pages" pageNumber={displayedPageNumber} pageSize={PAYMENT_PAGE_SIZE}
        rowCount={rows.length} previous={paging.previous} next={nextCursor && !error ? () => paging.next(nextCursor) : undefined}
        loading={loading} />}>
      {rows.map(row => {
        const legacy = row.kind === 'legacy'
        const organizer = legacy ? row.booking.captain_name : row.organizer
        return <tr key={paymentKey(row)}>
          <td data-label="Organizer"><span className="club-cell-stack"><strong>{organizer}</strong>
            <small>{legacy ? row.booking.contact : row.contact}</small></span></td>
          <td data-label="Payment for">{legacy ? <span className="club-cell-stack">
            <VenueLink name={row.game.venue} mapsUrl={row.game.maps_url} />
            <small>{dateLabel(row.game.starts_at)} · {timeLabel(row.game.starts_at)}</small>
          </span> : 'Checkout'}</td>
          <td data-label="Created">{dateLabel(row.created_at)}</td>
          <td data-label="Amount" className="club-numeric"><strong>{money(legacy ? row.booking.amount : row.amount)}</strong></td>
          <td data-label="Status"><PaymentStatus payment={row} /></td>
          <td data-label="Actions"><button type="button" className="club-button quiet" disabled={busy || loading || Boolean(error)}
            aria-label={`View payment details for ${organizer}`} onClick={() => setSelectedKey(paymentKey(row))}>Details</button></td>
        </tr>
      })}
    </CollectionTable>}
    {selected?.kind === 'checkout' && <CheckoutPaymentDetails key={selected.id}
      checkout={selected} userId={userId} refresh={refresh} close={close} busy={busy} action={action}
      actionError={actionError} transfer={transfer} saved={saved} onAccessLost={accessLost} />}
    {selected?.kind === 'legacy' && <Modal title="Payment details" close={close}>
      {selected.booking.status === 'reserved' && selected.booking.manual && !selected.booking.receipt && Boolean(methodsError) &&
        <div><ErrorNotice error={methodsError} />
          <button type="button" className="club-button" onClick={retryMethods}>Retry payment methods</button>
        </div>}
      {selected.booking.status === 'reserved' && selected.booking.manual && !selected.booking.receipt && !methodsError && moreMethods}
      {selected.booking.status === 'reserved' ? <PaymentReview booking={selected.booking} games={[selected.game]}
        methods={methods} busy={busy} action={async (name, data) => {
          const result = await action(name, data)
          if (result !== false) close()
          return result
        }} actionError={actionError} transfer={transfer ? () => transfer({ ...selected.booking, venue: selected.game.venue, starts_at: selected.game.starts_at }, close) : undefined}
        saved={saved} /> : <section className="club-confirm-summary">
        <strong>{selected.booking.captain_name} · {money(selected.booking.amount)}</strong>
        <span>{selected.game.venue} · {REGISTRATION_LABEL[selected.booking.kind]}</span>
        <PaymentStatus payment={selected} />
        {selected.booking.receipt?.review_note && <p>{selected.booking.receipt.review_note}</p>}
        {selected.booking.receipt && <div className="club-actions"><a className="club-button"
          href={`/api/club/asset?kind=receipt&id=${selected.booking.id}`}
          target="_blank" rel="noopener noreferrer">View receipt</a></div>}
      </section>}
    </Modal>}
  </>
}
