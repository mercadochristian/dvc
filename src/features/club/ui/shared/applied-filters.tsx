'use client'

import { useId, useRef, useState, type ReactNode } from 'react'

export interface AppliedFilter {
  key: string
  label: string
  remove: () => void
}

export function AppliedFilters({ filters, children, closeOnSubmit = false, liveResults = false }: {
  filters: AppliedFilter[]
  children: ReactNode
  closeOnSubmit?: boolean
  liveResults?: boolean
}) {
  const toggle = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [pointerOpen, setPointerOpen] = useState(false)

  function close() {
    setOpen(false)
    toggle.current?.focus({ preventScroll: true })
  }

  return <div className="club-filter-bar">
    <div className="club-filter-toolbar">
      {filters.length > 0 && <ul className="club-applied-filters" aria-label="Applied filters">
        {filters.map(filter => <li key={filter.key}>
          <button type="button" className="club-filter-pill" aria-label={`Remove ${filter.label}`} onClick={() => {
            filter.remove()
            toggle.current?.focus({ preventScroll: true })
          }}>
            <span>{filter.label}</span>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="m5 5 6 6m0-6-6 6"/>
            </svg>
          </button>
        </li>)}
      </ul>}
      <button ref={toggle} type="button" className="club-button quiet club-filter-toggle" aria-expanded={open}
        aria-controls={panelId} onClick={event => {
          setPointerOpen(!open && event.detail > 0)
          setOpen(value => !value)
        }}>
        <span aria-hidden="true">{open ? '−' : '+'}</span> {open ? 'Hide filters' : 'Add filter'}
      </button>
    </div>
    <div id={panelId} className="club-filter-panel" hidden={!open} data-pointer-entry={open && pointerOpen}
      onSubmit={closeOnSubmit ? close : undefined}>
      {liveResults && <p className="club-note">Results update as you change filters.</p>}
      {children}
      {liveResults && <button type="button" className="club-button quiet" onClick={close}>Show results</button>}
    </div>
  </div>
}
