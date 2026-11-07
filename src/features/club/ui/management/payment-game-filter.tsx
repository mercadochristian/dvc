'use client'

import type { PaymentGame } from '@/features/club/model/management-payments'
import { timeLabel } from '@/features/club/model/format'
import { CursorPagination } from '../shared/cursor-pagination'
import { ErrorNotice } from '../shared/primitives'
import { PAYMENT_PAGE_SIZE, usePaymentPage, usePaymentPaging } from './payment-page'

export function PaymentGameFilter({ date, userId, refresh, selected, select, onAccessLost, active = true }: {
  active?: boolean
  date: string
  userId: string
  refresh: number
  selected: PaymentGame | null
  select: (game: PaymentGame | null) => void
  onAccessLost?: () => void
}) {
  const paging = usePaymentPaging()
  const { page, loading, error, retry, displayedPageNumber } = usePaymentPage<PaymentGame>(userId, new URLSearchParams({
    mode: 'games', date, after: paging.after,
  }).toString(), refresh, onAccessLost, active, paging.pageNumber)
  const games = page?.rows ?? []
  const nextCursor = page?.next_cursor
  const selectedOnPage = games.some(game => game.id === selected?.id)

  return <>
    <select aria-label="Payment game" value={selected?.id ?? ''} onChange={event => {
      select(games.find(game => game.id === event.target.value) ?? null)
    }}>
      <option value="">{loading && !page ? 'Loading games…' : games.length || selected ? 'All games' : 'No games on this date'}</option>
      {selected && !selectedOnPage && <option value={selected.id}>{selected.venue} · {timeLabel(selected.starts_at)}</option>}
      {games.map(game => <option key={game.id} value={game.id}>{game.venue} · {timeLabel(game.starts_at)}</option>)}
    </select>
    {(paging.previous || nextCursor) && <CursorPagination label="Game filter pages" pageNumber={displayedPageNumber}
      pageSize={PAYMENT_PAGE_SIZE} rowCount={games.length} previous={paging.previous}
      next={nextCursor && !error ? () => paging.next(nextCursor) : undefined} loading={loading} />}
    <ErrorNotice error={error} />
    {Boolean(error) && <button type="button" className="club-button" onClick={retry}>Retry games</button>}
  </>
}
