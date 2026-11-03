'use client'

import { useEffect, useState } from 'react'
import { act, read } from '@/lib/club/client'
import type { ClubGame, PaymentMethod, Workspace } from '@/lib/club/types'
import { isAdministrator, managesLineups } from '@/lib/club/permissions'
import { VenueManager, FaciAssignments, PlayerSupport } from './operations'
import { Empty, ErrorNotice, Modal, Toast, Warning } from './primitives'
import { GameEditor, ManualRegistration, PaymentEditor, Transfer } from './staff-forms'
import { StaffGames, StaffRoster } from './staff-sections'
import { AccessTable, PaymentMethodsTable, PaymentsTable } from './staff-tables'

type StaffTab = 'games' | 'roster' | 'support' | 'facis' | 'venues' | 'payments' | 'methods' | 'access'
type Editor = { kind: 'game'; value?: ClubGame } | { kind: 'payment'; value?: PaymentMethod }
  | { kind: 'manual' } | { kind: 'transfer'; id: string }
const TAB_LABEL: Record<StaffTab, string> = {
  games: 'Games', roster: 'Rosters & lineups', payments: 'Payments',
  methods: 'Payment methods', access: 'Team access', support: 'Player support', facis: 'Faci schedule', venues: 'Venues',
}

export function Staff({ userId = '' }: { userId?: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [tab, setTab] = useState<StaffTab>('games'), [refresh, setRefresh] = useState(0)
  const [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null), [selectedGame, setSelectedGame] = useState('')

  useEffect(() => {
    let current = true
    setLoading(true)
    read<Workspace>('workspace').then(value => {
      if (!current) return
      setWorkspace(value)
      setSelectedGame(id => value.games.some(game => game.id === id) ? id : value.games[0]?.id || '')
      setTab(current => isAdministrator(value.role) || (value.role === 'coordinator' && ['games','roster','support','facis'].includes(current)) || (value.role === 'facilitator' && current === 'facis') ? current : value.role === 'facilitator' ? 'facis' : 'games')
    }).catch(error => {
      if (current) { setError(error); setWorkspace(null) }
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [refresh])

  function saved() {
    setEditor(null); setError(null); setNotice('Saved'); setRefresh(value => value + 1)
  }
  async function action(name: string, data: unknown) {
    if (busy) return false
    setError(null); setBusy(true); setNotice('')
    try { await act(name, data); saved(); return true } catch (error) { setError(error); return false } finally { setBusy(false) }
  }
  const admin = !!workspace && isAdministrator(workspace.role), coordinator = !!workspace && managesLineups(workspace.role), games = workspace?.games || []
  const tabs: StaffTab[] = admin ? ['games', 'roster', 'support', 'facis', 'venues', 'payments', 'methods', 'access'] : coordinator ? ['games', 'roster', 'support', 'facis'] : ['facis']
  if (loading && !workspace) return <Empty>Loading staff workspace…</Empty>

  return <div className="club-staff" aria-busy={loading || busy}>
    <div className="club-page-title">
      <h1>{workspace ? admin ? 'Club management' : coordinator ? 'Game management' : 'Faci schedule' : 'Manage club'}</h1>
      <button className="club-button" disabled={loading} onClick={() => { setError(null); setRefresh(value => value + 1) }}>Refresh</button>
    </div>
    {workspace && tabs.length > 1 && <nav className="club-tabs club-staff-tabs" aria-label="Staff sections">
      {tabs.map(value => <button key={value} className="club-button" aria-pressed={tab === value}
        onClick={() => { setTab(value); setNotice(''); setError(null) }}>{TAB_LABEL[value]}</button>)}
    </nav>}
    <ErrorNotice error={error} />
    {notice && <Toast key={`${notice}-${refresh}`} message={notice} />}

    {workspace && tab === 'games' && <>
      {admin && <div className="club-section-heading"><h2>Games</h2><div className="club-row-actions">
        <button className="club-button primary" onClick={() => setEditor({ kind: 'game' })}>New game</button>
        <button className="club-button" onClick={() => setEditor({ kind: 'manual' })}>Add registration</button>
      </div></div>}
      <StaffGames workspace={workspace} busy={busy}
        roster={id => { setSelectedGame(id); setTab('roster') }}
        edit={game => setEditor({ kind: 'game', value: game })}
        cancel={setCancelling} />
    </>}
    {workspace && coordinator && tab === 'roster' && <StaffRoster workspace={workspace} selected={selectedGame}
      select={setSelectedGame} busy={busy} save={action} error={error} />}
    {workspace && coordinator && tab === 'support' && <PlayerSupport workspace={workspace} busy={busy} action={action} actionError={error} add={() => setEditor({ kind: 'manual' })} />}
    {workspace && tab === 'facis' && <FaciAssignments workspace={workspace} userId={userId} busy={busy} action={action} actionError={error} />}
    {workspace && admin && tab === 'venues' && <VenueManager venues={workspace.venues || []} busy={busy} action={action} error={error} />}
    {admin && tab === 'payments' && <PaymentsTable bookings={workspace?.bookings || []} games={games} methods={workspace?.payments || []} busy={busy} action={action} error={error} transfer={id=>setEditor({kind:'transfer',id})} saved={saved}/>}
    {admin && tab === 'methods' && <PaymentMethodsTable methods={workspace?.payments || []} edit={method=>setEditor({kind:'payment',value:method})}/>}
    {admin && tab === 'access' && <AccessTable entries={workspace?.access || []} developer={workspace?.role==='developer'} busy={busy} action={action} actionError={error}/>}
    {cancelling && <Modal title="Cancel game" close={() => setCancelling(null)}><ErrorNotice error={error} /><div className="club-form"><Warning>This releases all registrations. Refunds must be handled separately.</Warning><button className="club-button danger" disabled={busy} onClick={() => void action('game.cancel', { id: cancelling }).then(ok => { if (ok) setCancelling(null) })}>Cancel game</button></div></Modal>}
    {editor?.kind === 'game' && <GameEditor venues={workspace?.venues || []} game={editor.value} close={() => setEditor(null)} saved={saved} />}
    {editor?.kind === 'payment' && <PaymentEditor method={editor.value} close={() => setEditor(null)} saved={saved} />}
    {editor?.kind === 'manual' && <ManualRegistration games={games} close={() => setEditor(null)} saved={saved} />}
    {editor?.kind === 'transfer' && <Transfer bookingId={editor.id} games={games} close={() => setEditor(null)} saved={saved} />}
  </div>
}
