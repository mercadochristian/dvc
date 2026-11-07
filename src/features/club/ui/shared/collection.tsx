'use client'
import type { ReactNode } from 'react'
import { Empty } from './primitives'

export function SearchField({ value, change, label, placeholder = 'Search' }: { value: string; change: (value: string) => void; label: string; placeholder?: string }) {
  return <label className="club-search"><span className="club-sr-only">{label}</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input type="search" value={value} onChange={event => change(event.target.value)} placeholder={placeholder} /></label>
}
export function CollectionTools({ children, count, noun = 'records', className = '' }: { children: ReactNode; count: number; noun?: string; className?: string }) {
  return <div className={`club-collection-tools ${className}`}>{children}<span className="club-result-count" role="status">{count} {count===1 && noun.endsWith('s') ? noun.slice(0,-1) : noun}</span></div>
}
export function CollectionTable({ label, headings, children, count, empty = 'No matching records.', className = '', footer }: { label: string; headings: string[]; children: ReactNode; count: number; empty?: string; className?: string; footer?: ReactNode }) {
  if (!count && !footer) return <Empty>{empty}</Empty>
  return <div className={`club-collection ${className}`}>
    {count ? <table className="club-table club-records" aria-label={label}><thead><tr>{headings.map(heading => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{children}</tbody></table> : <Empty>{empty}</Empty>}
    {footer}
  </div>
}
export function RecordStatus({ value, label }: { value: string; label?: string }) {
  const positive = ['published','reserved','approved','enabled','available'].includes(value)
  const negative = ['cancelled','rejected','error','disabled'].includes(value)
  return <span className={`club-badge club-record-status ${positive ? '' : negative ? 'danger' : 'neutral'}`}>{label || value.charAt(0).toUpperCase()+value.slice(1)}</span>
}
