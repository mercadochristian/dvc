'use client'
import { useState } from 'react'
import { matchesSearch } from '@/features/club/model/collections'
import type { PaymentMethod } from '@/features/club/model/types'
import { AppliedFilters } from '../shared/applied-filters'
import { CollectionTable, RecordStatus, SearchField } from '../shared/collection'
export function PaymentMethodsTable({methods,edit}:{methods:PaymentMethod[];edit:(method?:PaymentMethod)=>void}) {
  const [query,setQuery]=useState('')
  const rows=methods.filter(m=>matchesSearch(query,m.label,m.account_name,m.account_number))
  return <><div className="club-section-heading"><h2>Payment methods</h2><button className="club-button primary" onClick={()=>edit()}>Add payment method</button></div><AppliedFilters filters={query.trim() ? [{ key: 'query', label: `Search: ${query.trim()}`, remove: () => setQuery('') }] : []}><SearchField label="Search payment methods" placeholder="Search method or account" value={query} change={setQuery}/></AppliedFilters><CollectionTable label="Payment methods" headings={['Method','Account','QR code','Status','Actions']} count={rows.length} empty={methods.length?'No matching payment methods.':'No payment methods yet.'}>{rows.map(m=><tr key={m.id}><td data-label="Method"><strong>{m.label}</strong></td><td data-label="Account"><span className="club-cell-stack">{m.account_name}<small>{m.account_number}</small></span></td><td data-label="QR code">{m.qr_path?'Uploaded':'Not added'}</td><td data-label="Status"><RecordStatus value={m.enabled?'enabled':'disabled'}/></td><td data-label="Actions"><button type="button" className="club-button quiet" aria-label={`Edit ${m.label}`} onClick={()=>edit(m)}>Edit</button></td></tr>)}</CollectionTable></>
}
