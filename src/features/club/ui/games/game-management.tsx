'use client'
import type { ClubGame, Workspace } from '@/features/club/model/types'
import { isAdministrator, managesLineups } from '@/features/club/model/permissions'
import { useId, useRef, useState, type CSSProperties } from 'react'
import { GameEditor } from './game-editor'
import { ManualRegistration } from '../registration/manual-registration'
import { Transfer } from './booking-transfer'
import { StaffRoster } from '../lineups/lineup-board'
import { PaymentsTable } from '../management/payments-table'
import { FacilitatorEditor } from './facilitator-editor'
import { PlayerSupport } from '../registration/player-support'
import { dateLabel, timeLabel } from '@/features/club/model/format'
import { ErrorNotice, Modal, Warning } from '../shared/primitives'
export const GAME_OPERATION_LABEL = {
  manual: 'Add registration',
  roster: 'Roster & lineups',
  payments: 'Game payments',
  registrations: 'Game registrations',
  edit: 'Edit game',
  cancel: 'Cancel game',
  facilitators: 'Facilitators',
} as const
export type GameOperation = keyof typeof GAME_OPERATION_LABEL
type Action = (name: string, data: unknown, reportError?: (error: unknown) => void) => Promise<boolean | void>
export function GameActions({ game, workspace, userId, busy, action, open, compact = false, unavailable = false }: {
  game: ClubGame; workspace: Workspace; userId: string; busy: boolean; action: Action
  open: (operation: GameOperation) => void; compact?: boolean; unavailable?: boolean
}) {
  const menuId = `game-actions-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const anchorStyle = { '--game-action-anchor': `--${menuId}` } as CSSProperties
  function choose(operation: GameOperation) {
    menu.current?.hidePopover()
    trigger.current?.focus({ preventScroll: true })
    open(operation)
  }
  const manager = managesLineups(workspace.role), admin = isAdministrator(workspace.role)
  const upcoming = game.status === 'published' && Date.parse(game.starts_at) > Date.now()
  const active = game.status === 'published' && Date.parse(game.ends_at) > Date.now()
  const assigned = game.facilitators?.some(f => f.user_id === userId)
  const volunteer = active && <button type="button" className="club-button" disabled={busy} onClick={() => {
    menu.current?.hidePopover()
    void action('faci.self', { game_id: game.id, enabled: !assigned })
  }}>{assigned ? 'Withdraw as Facilitator' : 'Volunteer as Facilitator'}</button>
  const quick = manager && <>
    <button type="button" className="club-button" onClick={() => compact ? choose('roster') : open('roster')}>Roster &amp; lineups</button>
    <button type="button" className="club-button" disabled={!upcoming || busy} onClick={() => compact ? choose('manual') : open('manual')}>Register another player</button>
  </>
  return <div className="club-game-staff-actions">
    {!compact && <>{quick}{volunteer}</>}
    {(manager || (compact && active)) && <div className="club-more-actions" style={anchorStyle}>
      <button ref={trigger} type="button" disabled={unavailable} className="club-button club-more-trigger" popoverTarget={menuId}
        aria-label={compact ? `Actions for ${game.venue}, ${dateLabel(game.starts_at)}, ${timeLabel(game.starts_at)}` : undefined}
        onClick={event => { menu.current?.toggleAttribute('data-pointer-entry', event.detail > 0) }}>
        {compact ? 'Actions' : 'More actions'}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <div ref={menu} id={menuId} popover="auto" className="club-more-actions-menu" aria-label="Game actions">
        {compact && <p className="club-game-action-context"><strong>{game.venue}</strong><span>{dateLabel(game.starts_at)} · {timeLabel(game.starts_at)}</span></p>}
        {(manager || (compact && volunteer)) && <div className="club-game-action-group" role="group" aria-label="Players and facilitators">
          {manager && <p className="club-game-action-label" aria-hidden="true">Players and facilitators</p>}
          {compact && quick}
          {manager && <button type="button" className="club-button" onClick={() => choose('registrations')}>Registrations</button>}
          {manager && active && <button type="button" className="club-button" onClick={() => choose('facilitators')}>{game.facilitators?.length ? 'Manage facilitators' : 'Assign facilitator'}</button>}
          {compact && volunteer}
        </div>}
        {admin && <div className="club-game-action-group" role="group" aria-label="Game administration">
          <p className="club-game-action-label" aria-hidden="true">Game administration</p>
          <button type="button" className="club-button" onClick={() => choose('payments')}>Payments</button>
          {game.status !== 'cancelled' && <>
            <button type="button" className="club-button" onClick={() => choose('edit')}>Edit game</button>
            <button type="button" className="club-button danger" onClick={() => choose('cancel')}>Cancel game</button>
          </>}
        </div>}
      </div>
    </div>}
  </div>
}
export function GameOperationModal({ operation, workspace, gameId, busy, error, action, reloadRoster, saved, close }: { operation: GameOperation; workspace: Workspace; gameId: string; busy: boolean; error: unknown; action: Action; reloadRoster: () => Promise<Workspace>; saved: () => void; close: () => void }) {
  const game = workspace.games.find(g => g.id === gameId)
  const [transfer, setTransfer] = useState<{ id: string; onSaved: () => void } | null>(null)
  if (!game) return null
  const scoped = { ...workspace, games: [game], roster: workspace.roster.filter(r => r.game_id === gameId), support: workspace.support?.filter(r => r.game_id === gameId), bookings: workspace.bookings?.filter(b => b.game_id === gameId) }
  const optionLimit = workspace.limited_options && <Warning>Only the first 100 options are shown. If an option is missing, open this action from the game card.</Warning>
  if (operation === 'edit') return <GameEditor game={game} venues={workspace.venues} moreOptions={optionLimit} saved={() => { saved(); close() }} close={close} />
  if (operation === 'facilitators') return <FacilitatorEditor key={gameId} game={game} staff={workspace.staff} busy={busy} action={action} close={close} />
  if (operation === 'manual') return <ManualRegistration games={[game]} saved={() => { saved(); close() }} close={close} />
  const transferring = scoped.bookings?.find(booking => booking.id === transfer?.id)
  const title = GAME_OPERATION_LABEL[operation]
  return <><Modal wide={operation !== 'cancel'} title={title} close={close} dismissible={operation !== 'cancel' || !busy}><ErrorNotice error={error} />{optionLimit}
    {operation === 'roster' && <StaffRoster workspace={scoped} selected={gameId} select={() => undefined} busy={busy} save={action} reloadRoster={reloadRoster} />}
    {operation === 'payments' && <><p className="club-subtitle">{game.venue} · {dateLabel(game.starts_at)} · {timeLabel(game.starts_at)}</p><PaymentsTable scoped bookings={scoped.bookings || []} games={[game]} methods={workspace.payments || []} busy={busy} action={action} error={error} transfer={(id, onSaved) => setTransfer({ id, onSaved })} saved={saved} /></>}
    {operation === 'registrations' && <><p className="club-subtitle">{game.venue} · {dateLabel(game.starts_at)} · {timeLabel(game.starts_at)}</p><PlayerSupport workspace={scoped} busy={busy} action={action} actionError={error} scoped /></>}
    {operation === 'cancel' && <div className="club-form">
      <div className="club-confirm-summary">
        <strong>{game.venue}</strong>
        <span>{dateLabel(game.starts_at)} · {timeLabel(game.starts_at)}–{timeLabel(game.ends_at)}</span>
      </div>
      <Warning>This cancels the game and releases all registrations. If game emails are enabled, registered players with an email on file will be notified. Handle refunds separately.</Warning>
      <div className="club-actions">
        <button type="button" className="club-button" disabled={busy} onClick={close}>Keep game</button>
        <button type="button" className="club-button danger" disabled={busy}
          onClick={() => void action('game.cancel', { id: gameId }).then(ok => { if (ok) close() })}>Cancel game</button>
      </div>
    </div>}
  </Modal>
    {transfer && transferring && <Transfer booking={transferring} games={workspace.games} moreOptions={optionLimit}
      close={() => setTransfer(null)} saved={() => { transfer.onSaved(); setTransfer(null); saved() }} />}
  </>
}
