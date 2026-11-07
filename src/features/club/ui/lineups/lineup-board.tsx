'use client'
import { RequiredMark, RequiredNote } from '../shared/required'
import { LineupAnnouncement } from './lineup-announcement'
import { VenueLink } from '../shared/venue-link'
import { PlayerDetails, BalancingNote } from '../registration/player-details'
import { playerProfileFrom, profileSummary } from '@/features/club/model/player-profile'
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import { RequestError } from '@/features/club/api/client'
import { dateLabel, timeLabel } from '@/features/club/model/format'
import { canPlace, isUnassignedTeamExtra, lineupTeamCount, TEAM_POSITIONS } from '@/features/club/model/lineup'
import { POSITION_LABEL, type RosterEntry, type Workspace } from '@/features/club/model/types'
import { Empty, ErrorNotice, Modal, Warning } from '../shared/primitives'

type Save = (action: string, data: unknown, reportError?: (error: unknown) => void) => Promise<boolean | void>
export function LineupBoard({ workspace, selected, select, busy, save, reloadRoster }: { workspace: Workspace; selected: string; select: (id: string) => void; busy: boolean; save: Save; reloadRoster?: () => Promise<Workspace> }) {
  const [picked, setPicked] = useState<string | null>(null), [editing, setEditing] = useState<RosterEntry | null>(null)
  const [hint, setHint] = useState(''), [announcement, setAnnouncement] = useState(false)
  const [editorError, setEditorError] = useState<unknown>(null)
  const [reloadError, setReloadError] = useState<unknown>(null)
  const [reloading, setReloading] = useState(false)
  const [editorRevision, setEditorRevision] = useState(0)
  const reloadButton = useRef<HTMLButtonElement>(null)
  const board = useRef<HTMLElement>(null)
  const lineupHeading = useRef<HTMLHeadingElement>(null)
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null)
  const game = workspace.games.find(value => value.id === selected)
  const entries = workspace.roster.filter(entry => entry.game_id === selected)
  const player = entries.find(entry => entry.id === picked)
  const staleEdit = editorError instanceof RequestError && editorError.status === 409
    && editorError.message === 'Lineup changed. Refresh and try again'

  useEffect(() => {
    if (staleEdit && !busy && !reloading) reloadButton.current?.focus()
  }, [staleEdit, busy, reloading])

  function closeEditor() {
    const id = editing?.id
    setEditing(null)
    requestAnimationFrame(() => {
      const trigger = id && board.current?.querySelector<HTMLButtonElement>(`[data-edit-player="${CSS.escape(id)}"]`)
      if (trigger) trigger.focus()
      else lineupHeading.current?.focus()
    })
  }

  async function reloadEditor() {
    if (!editing || !reloadRoster || reloading) return
    setReloading(true)
    setReloadError(null)
    try {
      const latest = await reloadRoster()
      const entry = latest.roster.find(row => row.id === editing.id && row.game_id === selected)
      setEditorError(null)
      if (entry) {
        setEditing(entry)
        setEditorRevision(value => value + 1)
      } else {
        setHint('This player is no longer on the roster for this game.')
        closeEditor()
      }
    } catch (error) {
      setReloadError(error)
    } finally {
      setReloading(false)
    }
  }

  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || busy || reloading || staleEdit) return
    setEditorError(null)
    const form = new FormData(event.currentTarget)
    const ok = await save('roster.update', {
      id: editing.id, name: form.get('name'), profile: playerProfileFrom(form),
      team: editing.team, expected_team: editing.team, expected_version: editing.version ?? 0,
    }, setEditorError)
    if (ok !== false) closeEditor()
  }

  async function place(id: string, team: number | null) {
    const entry = entries.find(value => value.id === id)
    if (!entry || busy) return
    if (team !== null && game?.held_teams?.includes(team)) { setHint('That team is held for a registration. Refresh after the hold expires.'); return }
    if (!canPlace(entries, entry, team)) { setHint(entry.kind === 'team' ? 'Move a team registration to an empty team.' : 'Choose an empty slot matching this player’s position.'); return }
    setHint('')
    const saved = await save('roster.update', { id: entry.id, name: entry.name || '', team, expected_team: entry.team, expected_version: entry.version ?? 0 })
    if (saved !== false) {
      setPicked(null)
      lineupHeading.current?.focus({ preventScroll: true })
    }
  }
  function beginDrag(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (busy || event.button !== 0) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id, x: event.clientX, y: event.clientY, moved: false }
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current) return
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) current.moved = true
    if (current.moved) setDragPreview({ id: current.id, x: event.clientX, y: event.clientY })
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current; drag.current = null; setDragPreview(null)
    if (!current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!current.moved) { setPicked(current.id); return }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-lineup-team]')
    if (target) void place(current.id, target.dataset.lineupTeam === 'unassigned' ? null : Number(target.dataset.lineupTeam))
  }
  function card(entry: RosterEntry) {
    const extra = isUnassignedTeamExtra(entries, entry)
    const summary = profileSummary(entry)
    const details = <><strong>{entry.name || 'Player to be named'}</strong><span>{POSITION_LABEL[entry.position]}</span>{summary && <small className="club-player-balancing">{summary}</small>}</>
    return <div className={`club-player-chip${extra ? ' club-player-chip-extra' : ''}${picked === entry.id ? ' selected' : ''}`} key={entry.id}>
      {extra ? <div className="club-player-pick">{details}<small>Team registration extra</small></div> : <button type="button" className="club-player-pick" disabled={busy} aria-pressed={picked === entry.id} onClick={() => { setPicked(picked === entry.id ? null : entry.id); setHint('') }}>{details}</button>}
      {!extra && <button type="button" className="club-drag-handle club-no-print" aria-label={`Move ${entry.name || 'player'}`} disabled={busy} onPointerDown={event => beginDrag(event, entry.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; setDragPreview(null) }} onClick={event => { if (event.detail === 0) setPicked(entry.id) }}><svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="5" r="1.3"/><circle cx="11" cy="5" r="1.3"/><circle cx="5" cy="10" r="1.3"/><circle cx="11" cy="10" r="1.3"/><circle cx="5" cy="15" r="1.3"/><circle cx="11" cy="15" r="1.3"/></svg></button>}
      <button type="button" className="club-button quiet club-no-print" disabled={busy} data-edit-player={entry.id} onClick={() => {
        setEditorError(null)
        setReloadError(null)
        setEditing(entry)
      }} aria-label={`Edit ${entry.name || POSITION_LABEL[entry.position]}`}>Edit</button>
    </div>
  }
  if (!game) return <Empty>No games yet.</Empty>
  return <section ref={board} className="club-print-area club-lineup">
    <div className="club-page-title"><div><h2 ref={lineupHeading} tabIndex={-1}><VenueLink name={game.venue} mapsUrl={game.maps_url} /></h2><p className="club-note">{dateLabel(game.starts_at)} · {timeLabel(game.starts_at)}–{timeLabel(game.ends_at)}</p></div><span className="club-badge neutral">{entries.length} players</span></div>
    <div className="club-roster-toolbar club-no-print">{workspace.games.length > 1 && <label>Game<select value={selected} onChange={event => { select(event.target.value); setPicked(null); setHint('') }}>{workspace.games.map(value => <option key={value.id} value={value.id}>{value.venue} · {dateLabel(value.starts_at)}</option>)}</select></label>}<div className="club-actions"><button className="club-button" onClick={() => setAnnouncement(true)}>Announcement preview</button><button className="club-button" onClick={() => window.print()}>Print lineup</button></div></div>
    {!player && entries.some(entry => !isUnassignedTeamExtra(entries, entry)) && <p className="club-note club-no-print">Select a player, then choose a matching slot. You can also drag the player by their handle.</p>}
    {hint && <Warning>{hint}</Warning>}
    {player && <div className="club-lineup-selection club-no-print" role="status"><span>Move {player.kind === 'team' ? 'team registration' : player.name || 'player'}: choose a matching slot{player.kind === 'team' ? ' in an empty team' : ''}.</span><button className="club-button quiet" onClick={() => setPicked(null)}>Cancel</button></div>}
    <div className="club-lineup-layout"><aside className="club-unassigned club-no-print" data-lineup-team="unassigned"><header><h3>Unassigned</h3><span>{entries.filter(entry => entry.team === null).length}</span></header>{entries.filter(entry => entry.team === null).map(card)}{!entries.some(entry => entry.team === null) && <p className="club-note">{entries.length ? 'All players have a team.' : 'No players registered yet.'}</p>}{player?.kind !== 'team' && player?.team && <button className="club-button" disabled={busy} onClick={() => void place(player.id, null)}>Move to unassigned</button>}</aside>
      <div className="club-team-board">{Array.from({ length: lineupTeamCount(game) }, (_, index) => index + 1).map(team => {
        const members = entries.filter(entry => entry.team === team), registeredTeam = members.some(entry => entry.kind === 'team'), held = game.held_teams?.includes(team)
        const used = new Set<string>()
        return <section className="club-team" key={team} data-lineup-team={team} aria-label={`Team ${team}`}><header><h3>Team {team}</h3><span className="club-badge neutral">{held ? 'Held for registration' : registeredTeam ? 'Team registration' : `${members.length} / 6`}</span></header><div className="club-team-slots">{TEAM_POSITIONS.map((position, slot) => {
          const member = members.find(entry => entry.position === position && !used.has(entry.id)); if (member) used.add(member.id)
          return member ? card(member) : <button key={`slot-${slot}`} type="button" className="club-team-slot" disabled={busy || held || !player || player.position !== position || !canPlace(entries, player, team)} aria-label={`Assign ${POSITION_LABEL[position]} to Team ${team}`} onClick={() => player && void place(player.id, team)}><span>{POSITION_LABEL[position]}</span><small>Empty slot</small></button>
        })}</div></section>
      })}</div>
    </div>
    {dragPreview && <div className="club-drag-preview" style={{ left: dragPreview.x + 14, top: dragPreview.y + 14 }} aria-hidden="true">{entries.find(entry => entry.id === dragPreview.id)?.kind === 'team' ? 'Move team registration' : entries.find(entry => entry.id === dragPreview.id)?.name || 'Move player'}</div>}
    {announcement && <LineupAnnouncement game={game} entries={entries} close={() => setAnnouncement(false)} />}
    {editing && <Modal key={editorRevision} title={editing.name ? 'Edit player' : 'Add player details'} close={closeEditor} dismissible={!busy && !reloading}>
      <ErrorNotice error={editorError} />
      <ErrorNotice error={reloadError} />
      {staleEdit && reloadRoster && <div className="club-form">
        <p>Reload this player to see the latest details. Reloading discards your unsaved edits.</p>
        <button ref={reloadButton} type="button" className="club-button" disabled={reloading} onClick={() => void reloadEditor()}>
          {reloading ? 'Reloading…' : 'Reload player'}
        </button>
      </div>}
      <form className="club-form" onSubmit={submitEditor}>
        <RequiredNote />
        <label><span>Name{editing.is_registrant && <RequiredMark />}</span><input name="name" required={editing.is_registrant} maxLength={100} defaultValue={editing.name || ''} placeholder="Player to be named" /></label>
        <p className="club-note">{POSITION_LABEL[editing.position]}{editing.team ? ` · Team ${editing.team}` : ' · Unassigned'}</p>
        <PlayerDetails required={!editing.name} value={editing} gameDate={game.starts_at} />
        <BalancingNote />
        <button className="club-button primary" disabled={busy || reloading || staleEdit}>Save player</button>
      </form>
    </Modal>}
  </section>
}

export { LineupBoard as StaffRoster }
