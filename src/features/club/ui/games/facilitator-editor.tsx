'use client'

import { useRef, useState } from 'react'
import { dateLabel, timeLabel } from '@/features/club/model/format'
import type { ClubGame, Workspace } from '@/features/club/model/types'
import { ErrorNotice, Modal, Warning } from '../shared/primitives'
import { RequiredLabel } from '../shared/required'

type Assignment = { game_id: string; user_id: string; enabled: boolean }
type Props = {
  game: ClubGame
  staff: Workspace['staff']
  busy: boolean
  action: (name: 'faci.assign', data: Assignment, reportError: (error: unknown) => void) => Promise<boolean | void>
  close: () => void
}

export function FacilitatorEditor({ game, staff, busy, action, close }: Props) {
  const [selectedStaff, setSelectedStaff] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const assigned = game.facilitators ?? []
  const eligibleStaff = (staff ?? []).filter(member => !assigned.some(facilitator => facilitator.user_id === member.id))
  const selection = eligibleStaff.some(member => member.id === selectedStaff) ? selectedStaff : ''
  const active = game.status === 'published' && Date.parse(game.ends_at) > Date.now()
  const disabled = busy || saving || !active

  async function change(userId: string | undefined, enabled: boolean) {
    if (disabled || pending.current || !userId) return
    pending.current = true
    setSaving(true)
    setError(null)
    let reported = false
    try {
      const ok = await action('faci.assign', { game_id: game.id, user_id: userId, enabled }, failure => {
        reported = true
        setError(failure)
      })
      if (ok !== false) close()
      else if (!reported) setError(new Error('The assignment could not be updated. Try again.'))
    } catch (failure) {
      setError(failure)
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return <Modal title={assigned.length ? 'Manage facilitators' : 'Assign facilitator'} close={close} dismissible={!saving}>
    <div className="club-form">
      <p className="club-note">{game.venue} · {dateLabel(game.starts_at)} · {timeLabel(game.starts_at)}</p>
      <ErrorNotice error={error} />
      {saving && <p className="club-note" role="status">Saving facilitator changes…</p>}
      {!active && <Warning>Facilitators can only be changed for published games that haven’t ended.</Warning>}
      {!!assigned.length && <ul className="club-assigned-list" aria-label="Assigned facilitators">
        {assigned.map(member => <li className="club-inline" key={member.user_id || member.name}>
          <span>{member.name}</span>
          {member.user_id && <button type="button" className="club-button quiet danger" disabled={disabled}
            aria-label={`Remove ${member.name}`} onClick={() => void change(member.user_id, false)}>Remove</button>}
        </li>)}
      </ul>}
      {eligibleStaff.length ? <form className="club-form" onSubmit={event => { event.preventDefault(); void change(selection, true) }}>
        <label><RequiredLabel>Staff member</RequiredLabel>
          <select required value={selection} disabled={disabled} onChange={event => setSelectedStaff(event.target.value)}>
            <option value="" disabled>Choose staff member</option>
            {eligibleStaff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <div className="club-actions"><button type="submit" className="club-button primary" disabled={disabled || !selection}>Assign</button></div>
      </form> : <p className="club-note">No available staff to assign.</p>}
    </div>
  </Modal>
}
