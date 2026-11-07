'use client'

import { useRef, useState } from 'react'
import { act, RequestError } from '@/features/club/api/client'
import type { Booking, PaymentMethod, StaffRole, Venue } from '@/features/club/model/types'
import { isAdministrator } from '@/features/club/model/permissions'
import { VenueManager } from './venue-manager'
import { Empty, ErrorNotice, RefreshButton, Toast } from '../shared/primitives'
import { MoreOptions, OptionsState, useOptions } from '../shared/management-options'
import { PaymentEditor } from './payment-method-editor'
import { Transfer, type TransferGame } from '../games/booking-transfer'
import { PaymentMethodsTable } from './payment-methods-table'
import { GlobalPayments } from './global-payments'
import { UsersTable } from './users'
import { AnnouncementManager } from './announcements'

type Tab = 'users' | 'venues' | 'payments' | 'methods' | 'announcements'
type Editor = { kind: 'payment'; value?: PaymentMethod } | { kind: 'transfer'; booking: Booking; onSaved: () => void }

const LABEL: Record<Tab, string> = {
  users: 'Users', venues: 'Venues', payments: 'Payments', methods: 'Payment methods', announcements: 'Announcements',
}

export function Staff({ userId, role, reconcileSession, resetManagement }: {
  userId: string; role: StaffRole; reconcileSession: () => void; resetManagement: () => void
}) {
  const admin = isAdministrator(role)
  const [tab, setTab] = useState<Tab>(admin ? 'users' : 'announcements')
  const [visited, setVisited] = useState<Tab[]>([tab])
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [accessLost, setAccessLost] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState(0)
  const [editor, setEditor] = useState<Editor | null>(null)
  const pending = useRef(false)
  const onAccessLost = useRef(() => {
    setAccessLost(true)
    setEditor(null)
    reconcileSession()
  }).current
  const venues = useOptions<Venue>('management-venues', tab === 'venues', refresh, onAccessLost)
  const methods = useOptions<PaymentMethod>('management-methods', (tab === 'methods' || tab === 'payments'), refresh, onAccessLost)
  const destinations = useOptions<TransferGame>('management-destinations', editor?.kind === 'transfer', refresh, onAccessLost)
  const tabs: Tab[] = admin ? ['users', 'venues', 'payments', 'methods', 'announcements'] : ['announcements']

  function reload() {
    setError(null)
    setRefresh(value => value + 1)
  }

  function saved() {
    setEditor(null)
    setNotice(value => value + 1)
    reload()
  }

  async function action(name: string, data: unknown, inlineError = false) {
    if (pending.current) return false
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await act(name, data)
      saved()
      if (name === 'access.save') reconcileSession()
      return true
    } catch (error) {
      if (error instanceof RequestError && [401, 403].includes(error.status ?? 0)) reconcileSession()
      if (inlineError) throw error
      setError(error)
      return false
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  if (accessLost) return <div>
    <Empty>Management access needs to be verified again.</Empty>
    <button type="button" className="club-button" onClick={resetManagement}>Refresh session</button>
  </div>
  const section = tab === 'venues' ? venues : tab === 'methods' ? methods : null
  return <div className="club-staff">
    <div className="club-page-title club-management-title">
      <h1>Manage club</h1>
      <div className="club-actions club-management-actions">
        <RefreshButton disabled={busy || section?.loading} onClick={reload} />
      </div>
    </div>
    {tabs.length > 1 && <nav className="club-tabs club-staff-tabs" aria-label="Club management sections">
      {tabs.map(value => <button key={value} type="button" className="club-button" disabled={busy} aria-pressed={value === tab}
        onClick={() => { setTab(value); setVisited(prior => prior.includes(value) ? prior : [...prior, value]); setError(null) }}>{LABEL[value]}</button>)}
    </nav>}
    <ErrorNotice error={error} />
    {notice > 0 && <Toast key={notice} message="Saved" />}
    {section && <><ErrorNotice error={section.error} />{!section.rows && !section.error && <Empty>Loading {LABEL[tab].toLowerCase()}…</Empty>}</>}
    {admin && visited.includes('users') && <div hidden={tab !== 'users'}><UsersTable active={tab === 'users'} developer={role === 'developer'} busy={busy} revision={refresh}
      action={(name, data) => action(name, data, true)} onAccessLost={onAccessLost} /></div>}
    {admin && visited.includes('venues') && venues.rows && <div hidden={tab !== 'venues'}><VenueManager venues={venues.rows} busy={busy} action={action} error={error} /></div>}
    {admin && visited.includes('payments') && <div hidden={tab !== 'payments'}><GlobalPayments active={tab === 'payments'} userId={userId} refresh={refresh} busy={busy} action={action}
      actionError={error} methods={methods.rows ?? undefined} methodsError={methods.error} retryMethods={methods.loadMore} moreMethods={<MoreOptions options={methods} noun="payment methods" />} saved={saved} onAccessLost={onAccessLost} transfer={(booking, onSaved) => setEditor({ kind: 'transfer', booking, onSaved })} /></div>}
    {admin && visited.includes('methods') && methods.rows && <div hidden={tab !== 'methods'}><PaymentMethodsTable methods={methods.rows} edit={value => setEditor({ kind: 'payment', value })} /></div>}
    {visited.includes('announcements') && <div hidden={tab !== 'announcements'}><AnnouncementManager
      userId={userId} active={tab === 'announcements'} revision={refresh} onAccessLost={onAccessLost}
      busy={busy} action={action} error={error} /></div>}
    {section?.rows && section.hasMore && (tab === 'venues' || tab === 'methods') &&
      <p className="club-note">Search covers the records loaded so far. Load more to extend the search.</p>}
    {section && <MoreOptions options={section} noun={tab === 'venues' ? 'venues' : 'payment methods'} />}
    {admin && editor?.kind === 'payment' && <PaymentEditor method={editor.value} close={() => setEditor(null)} saved={saved} />}
    {admin && editor?.kind === 'transfer' && <Transfer booking={editor.booking} games={destinations.rows ?? []}
      optionsState={!destinations.rows ? <OptionsState error={destinations.error} retry={reload} /> : undefined}
      moreOptions={<><ErrorNotice error={destinations.rows ? destinations.error : null} />{destinations.rows && <MoreOptions options={destinations} noun="games" />}</>}
      close={() => setEditor(null)} saved={() => { editor.onSaved(); saved() }} />}
  </div>
}
