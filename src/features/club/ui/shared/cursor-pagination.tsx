'use client'

import styles from './cursor-pagination.module.css'

export interface CursorPaginationProps {
  label: string
  pageNumber: number
  pageSize: number
  rowCount: number
  previous?: () => void
  next?: () => void
  loading?: boolean
  total?: number
}

export function CursorPagination({
  label, pageNumber, pageSize, rowCount, previous, next, loading = false, total,
}: CursorPaginationProps) {
  const offset = (pageNumber - 1) * pageSize
  const range = rowCount ? `${offset + 1}–${offset + rowCount}` : '0'
  const hasControls = pageNumber > 1 || Boolean(previous || next)
  if (!rowCount && !hasControls && !loading) return null
  const summary = `Showing ${range}${total === undefined ? '' : ` of ${total}`}`

  return <nav className={styles.footer} aria-label={label} aria-busy={loading}>
    <span role="status">{loading ? (rowCount ? `${summary} · Loading…` : 'Loading results…') : summary}</span>
    {hasControls && <div className={styles.controls}>
      <button type="button" className="club-button quiet" aria-disabled={loading || !previous}
        onClick={() => { if (!loading) previous?.() }}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 3-5 5 5 5" /></svg>
        Previous
      </button>
      <button type="button" className="club-button quiet" aria-disabled={loading || !next}
        onClick={() => { if (!loading) next?.() }}>
        Next
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
      </button>
    </div>}
  </nav>
}
