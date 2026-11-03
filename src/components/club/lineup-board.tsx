'use client'
import { VenueLink } from './venue-link'
import { PlayerDetails, BalancingNote } from './player-details'
import { playerProfileFrom, profileSummary } from '@/lib/club/player-profile'
import { useRef, useState, type PointerEvent } from 'react'
import { dateLabel, timeLabel } from '@/lib/club/client'
import { canPlace, lineupTeamCount, TEAM_POSITIONS } from '@/lib/club/lineup'
import { POSITION_LABEL, type RosterEntry, type Workspace } from '@/lib/club/types'
import { Empty, ErrorNotice, Modal, Warning } from './primitives'

type Save = (action: string, data: unknown) => Promise<boolean | void>
export function LineupBoard({ workspace, selected, select, busy, save, error }: { workspace: Workspace; selected: string; select: (id: string) => void; busy: boolean; save: Save; error?: unknown }) {
  const [picked, setPicked] = useState<string | null>(null), [editing, setEditing] = useState<RosterEntry | null>(null)
  const [hint, setHint] = useState('')
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null)
  const game = workspace.games.find(value => value.id === selected)
  const entries = workspace.roster.filter(entry => entry.game_id === selected)
  const player = entries.find(entry => entry.id === picked)
  async function place(id: string, team: number | null) {
    const entry = entries.find(value => value.id === id)
    if (!entry || busy) return
    if (team !== null && game?.held_teams?.includes(team)) { setHint('That team is held for a registration. Refresh after the hold expires.'); return }
    if (!canPlace(entries, entry, team)) { setHint(entry.kind === 'team' ? 'Move a team registration to an empty team.' : 'Choose an empty slot matching this player’s position.'); return }
    setHint(''); setPicked(null)
    await save('roster.update', { id: entry.id, name: entry.name || '', team, expected_team: entry.team, expected_version: entry.version ?? 0 })
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
    return <div className={`club-player-chip${picked === entry.id ? ' selected' : ''}`} key={entry.id}>
      <button type="button" className="club-drag-handle club-no-print" aria-label={`Move ${entry.name || 'player'}`} disabled={busy} onPointerDown={event => beginDrag(event, entry.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; setDragPreview(null) }} onClick={event => { if (event.detail === 0) setPicked(entry.id) }}><svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="5" r="1.3"/><circle cx="11" cy="5" r="1.3"/><circle cx="5" cy="10" r="1.3"/><circle cx="11" cy="10" r="1.3"/><circle cx="5" cy="15" r="1.3"/><circle cx="11" cy="15" r="1.3"/></svg></button>
      <button type="button" className="club-player-pick" disabled={busy} aria-pressed={picked === entry.id} onClick={() => { setPicked(picked === entry.id ? null : entry.id); setHint('') }}><strong>{entry.name || 'Player to be named'}</strong><span>{POSITION_LABEL[entry.position]}</span>{profileSummary(entry) && <small className="club-player-balancing">{profileSummary(entry)}</small>}</button>
      <button type="button" className="club-button quiet club-no-print" disabled={busy} onClick={() => setEditing(entry)} aria-label={`Edit ${entry.name || POSITION_LABEL[entry.position]}`}>Edit</button>
    </div>
  }
  if (!game) return <Empty>No games yet.</Empty>
  return <section className="club-print-area club-lineup">
    <div className="club-roster-toolbar club-no-print"><label>Game<select value={selected} onChange={event => { select(event.target.value); setPicked(null); setHint('') }}>{workspace.games.map(value => <option key={value.id} value={value.id}>{value.venue} · {dateLabel(value.starts_at)}</option>)}</select></label><button className="club-button" onClick={() => window.print()}>Print lineup</button></div>
    <div className="club-page-title"><div><h2><VenueLink name={game.venue} mapsUrl={game.maps_url} /></h2><p className="club-note">{dateLabel(game.starts_at)} · {timeLabel(game.starts_at)}–{timeLabel(game.ends_at)}</p></div><span className="club-badge neutral">{entries.length} players</span></div>
    {hint && <Warning>{hint}</Warning>}
    {player && <div className="club-lineup-selection club-no-print" role="status"><span>Move {player.kind === 'team' ? 'team registration' : player.name || 'player'}: choose a matching slot{player.kind === 'team' ? ' in an empty team' : ''}.</span><button className="club-button quiet" onClick={() => setPicked(null)}>Cancel</button></div>}
    <div className="club-lineup-layout"><aside className="club-unassigned club-no-print" data-lineup-team="unassigned"><header><h3>Unassigned</h3><span>{entries.filter(entry => entry.team === null).length}</span></header>{entries.filter(entry => entry.team === null).map(card)}{!entries.some(entry => entry.team === null) && <p className="club-note">All players have a team.</p>}{player?.kind !== 'team' && player?.team && <button className="club-button" disabled={busy} onClick={() => void place(player.id, null)}>Move to unassigned</button>}</aside>
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
    {editing && <Modal title="Edit player" close={() => setEditing(null)}><ErrorNotice error={error} /><form className="club-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget), name = form.get('name'); void save('roster.update', { id: editing.id, name, profile: playerProfileFrom(form), team: editing.team, expected_team: editing.team, expected_version: editing.version ?? 0 }).then(ok => { if (ok !== false) setEditing(null) }) }}><label>Name<input name="name" maxLength={100} defaultValue={editing.name || ''} placeholder="Player to be named" /></label><p className="club-note">{POSITION_LABEL[editing.position]}{editing.team ? ` · Team ${editing.team}` : ' · Unassigned'}</p><PlayerDetails required={!editing.name} value={editing} /><BalancingNote /><button className="club-button primary" disabled={busy}>Save player</button></form></Modal>}
  </section>
}
