'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { RequestError } from '@/lib/club/client'

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null
  return <div className="club-error" role="alert"><p>{error instanceof Error ? error.message : 'Could not complete the request'}</p>{error instanceof RequestError && error.reference && <small>Reference: <code>{error.reference}</code></small>}</div>
}
export function Modal({ title, close, children }: { title: ReactNode; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId()
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close() } }, [])
  return <dialog ref={ref} className="club-dialog" onCancel={close} aria-labelledby={titleId}><header><h2 id={titleId}>{title}</h2><button type="button" className="club-button quiet club-icon-button" onClick={close} aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></header><div className="club-dialog-body">{children}</div></dialog>
}
export function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === 'left' ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'} /></svg>
}
export function ClubIcon({ name }: { name: 'calendar' | 'ticket' | 'club' | 'code' | 'court' | 'refresh' }) {
  const paths = {
    calendar: 'M8 3v4m8-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm3 9h2m4 0h2m-8 3h2',
    ticket: 'M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4V5Zm11 3v2m0 4v2',
    club: 'M9 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 7v-2c0-2 3-3 6-3s6 1 6 3v2m1-13a3 3 0 0 1 0 6m2 3c2 .5 3 1.5 3 3v1',
    code: 'm8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16',
    court: 'M4 3h16v18H4V3Zm0 9h16M4 8h16M4 16h16M12 3v18',
    refresh: 'M20 7v5h-5M4 17v-5h5m10-3a7 7 0 0 0-12-3L4 9m1 6a7 7 0 0 0 12 3l3-3',
  }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
export function Empty({ children }: { children: ReactNode }) { const loading = typeof children === 'string' && children.startsWith('Loading')
  return <div className={`club-empty${loading ? ' club-loading' : ''}`} role={loading ? 'status' : undefined}>{!loading && <ClubIcon name="calendar" />}<p>{children}</p></div> }

export function Toast({ message }: { message: string }) {
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => { const timer = setTimeout(() => setDismissed(true), 6000); return () => clearTimeout(timer) }, [])
  if (dismissed) return null
  return <div className="club-toast" role="status"><p>{message}</p><button type="button" className="club-button quiet club-icon-button" aria-label="Dismiss notification" onClick={() => setDismissed(true)}> <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
}
export function Warning({ children }: { children: ReactNode }) { return <div className="club-warning" role="alert">{children}</div> }
