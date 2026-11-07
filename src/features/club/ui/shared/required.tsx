import type { ReactNode } from 'react'

export function RequiredMark() { return <span className="club-required" aria-hidden="true"> *</span> }
export function RequiredNote() { return <p className="club-note"><span aria-hidden="true">*</span> Required fields</p> }

export function RequiredLabel({ children }: { children: ReactNode }) {
  return <span>{children}<RequiredMark /></span>
}
