'use client'
import { useId, useState } from 'react'
import { manilaDate } from '@/features/club/model/format'
import { checkoutPlayerErrors, checkoutPlayerStatus, type PlayerField } from '@/features/club/model/checkout-fields'
import type { CheckoutPlayerForm } from '@/features/club/model/checkout-form'
import { GENDER_LABEL, LEVEL_LABEL, POSITIONS, POSITION_LABEL, type ClubGame, type ClubPosition } from '@/features/club/model/types'
import { RequiredMark } from '../shared/required'

export function CheckoutPlayer({ player, index, organizerName, updateOrganizerName, game, update, remove, removeLabel = 'Remove player', availability, positionLocked = false, skillLocked = false, compact = false, manual = false, expanded: controlledExpanded, onExpandedChange, validationAttempted = false }: {
  player: CheckoutPlayerForm; index: number; kind: 'individual' | 'group' | 'team'; organizerName: string; updateOrganizerName?: (name: string) => void; game: Pick<ClubGame, 'id' | 'starts_at' | 'positions'>
  update: (changes: Partial<CheckoutPlayerForm>) => void; remove?: () => void; removeLabel?: string
  availability?: Record<ClubPosition, number>
  expanded?: boolean; onExpandedChange?: (expanded: boolean) => void
  validationAttempted?: boolean
  positionLocked?: boolean
  skillLocked?: boolean
  compact?: boolean
  manual?: boolean
}) {
  const fieldId = useId()
  const [invalidAttempt, setInvalidAttempt] = useState(false)
  const [localExpanded, setLocalExpanded] = useState(true)
  const expanded = controlledExpanded ?? localExpanded
  function setExpanded(value: boolean) { if (onExpandedChange) onExpandedChange(value); else setLocalExpanded(value) }
  const name = player.is_registrant ? organizerName : player.name
  const status = checkoutPlayerStatus(player, organizerName)
  const title = player.has_details && name.trim() ? name : player.is_registrant ? manual ? 'Organizer' : 'You' : `Player ${index + 1}`
  const errors = validationAttempted || invalidAttempt ? checkoutPlayerErrors(player, organizerName) : {}
  function field(field: PlayerField, help?: string) {
    return { 'data-player-field': field, 'aria-label': field === 'first_timer' ? undefined : ({ name: 'Name', level: 'Skill level', gender: 'Gender', birth_date: 'Birthday', email: 'Email' } as const)[field], 'aria-invalid': errors[field] ? true as const : undefined, 'aria-describedby': [help, errors[field] ? `${fieldId}-${field}-error` : undefined].filter(Boolean).join(' ') || undefined }
  }
  function error(field: PlayerField) { return errors[field] ? <small className="club-selection-warning" id={`${fieldId}-${field}-error`}>{errors[field]}</small> : null }
  const positionHelp = `${fieldId}-position-help`, emailHelp = `${fieldId}-email-help`
  const today = manilaDate(new Date()), gameDate = manilaDate(new Date(game.starts_at))
  return <div className="club-checkout-person" data-player-id={player.form_id}>
    <details open={expanded} onToggle={event => { if (event.currentTarget.open !== expanded) setExpanded(event.currentTarget.open) }} onInvalidCapture={event => {
      // Native constraint validation must be able to focus a field inside a
      // collapsed player. Open synchronously before the browser focuses it.
      event.currentTarget.open = true; setExpanded(true); setInvalidAttempt(true)
    }}>
      <summary>
        {compact ? <span className="club-checkout-compact-row">
          <strong>{title}</strong>
          <small>{POSITION_LABEL[player.position]}{status !== 'Details complete' || expanded ? ` · ${status}` : ''}</small>
          {!expanded && <span className="club-checkout-edit-label">Edit</span>}
        </span> : <span><strong>Player {index + 1}{player.is_registrant ? ' · You' : ''}{player.has_details && name.trim() ? ` · ${name}` : ''}</strong><small>{POSITION_LABEL[player.position]} · {status}</small></span>}
      </summary>
      {(controlledExpanded === undefined || expanded) && <fieldset className="club-checkout-player"><legend>Player {index + 1} details</legend>
        {positionLocked ? <div className="club-cell-stack"><span className="club-field-label">Position</span><strong>{POSITION_LABEL[player.position]}</strong></div> : <div className="club-field"><label><span className="club-field-label">Position<RequiredMark /></span><select required aria-label="Position" aria-describedby={compact ? undefined : positionHelp} value={player.position} onChange={event => update({ position: event.target.value as ClubPosition })}>{POSITIONS.map(position => {
          const slot = game.positions.find(slot => slot.position === position)
          const available = availability?.[position] ?? slot?.available ?? 0
          return <option value={position} key={position} disabled={position !== player.position && (slot?.available ?? 0) === 0}>{POSITION_LABEL[position]} · {(slot?.available ?? 0) === 0 ? 'Full' : available > 0 ? `${available} left` : '0 free · reassign'}</option>
        })}</select></label>{!compact && <small id={positionHelp}>Counts include the other players entered. A position with 0 free slots needs another player reassigned before continuing.</small>}</div>}
        <label className="club-check"><input type="checkbox" checked={player.has_details} onChange={event => update({ has_details: event.target.checked })} /> Player details available</label>
        {!compact && <p className="club-note">{player.has_details ? 'Name, gender, skill level, position and first-timer status are used for the lineup.' : 'Check this box to add lineup details, including skill level.'}</p>}
        {player.has_details ? <>
          <label><span className="club-field-label">Name<RequiredMark /></span><input {...field('name')} autoComplete="off" maxLength={100} required readOnly={player.is_registrant && !updateOrganizerName} value={name} onChange={event => player.is_registrant && updateOrganizerName ? updateOrganizerName(event.target.value) : update({ name: event.target.value })} /></label>{error('name')}
          <div className="club-form-grid">
            <label><span className="club-field-label">Skill level<RequiredMark /></span><select {...field('level')} disabled={skillLocked} required value={player.level || ''} onChange={event => update({ level: event.target.value as CheckoutPlayerForm['level'] })}><option value="">Choose skill level</option>{Object.entries(LEVEL_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{error('level')}</label>
            <label><span className="club-field-label">Gender<RequiredMark /></span><select {...field('gender')} required value={player.gender || ''} onChange={event => update({ gender: event.target.value as CheckoutPlayerForm['gender'] })}><option value="">Choose option</option>{Object.entries(GENDER_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{error('gender')}</label>
          </div>
          <label><span className="club-field-label">Birthday<RequiredMark /></span><input {...field('birth_date')} type="date" required max={today < gameDate ? today : gameDate} value={player.birth_date} onChange={event => update({ birth_date: event.target.value })} />{error('birth_date')}</label>
          <fieldset className="club-choice"><legend>First time playing with DVC?<RequiredMark /></legend><label><input {...field('first_timer')} type="radio" name={`${game.id}-player-${player.form_id || index}-first-timer`} required checked={player.first_timer === true} onChange={() => update({ first_timer: true })} /> First-timer</label><label><input {...field('first_timer')} type="radio" name={`${game.id}-player-${player.form_id || index}-first-timer`} required checked={player.first_timer === false} onChange={() => update({ first_timer: false })} /> Returnee</label>{error('first_timer')}</fieldset>
          {!player.is_registrant && <div className="club-field"><label><span className="club-field-label">Email <span className="club-field-optional">(optional)</span></span><input {...field('email', emailHelp)} type="email" autoComplete="off" maxLength={254} value={player.email} onChange={event => update({ email: event.target.value })} /></label><small id={emailHelp}>Receive only this player's game schedule.</small>{error('email')}</div>}
        </> : <p className="club-note">{manual ? 'Reserve this position without personal details.' : compact && Date.parse(game.starts_at) - Date.now() > 3_600_000 ? 'Book this position and add player details before the one-hour cutoff.' : positionLocked ? 'Save without personal details. Your reserved position stays the same.' : Date.parse(game.starts_at) - Date.now() > 3_600_000 ? 'Reserve this position without personal details. Add or edit details in My bookings until one hour before the game.' : 'Player details lock after booking within one hour of this game. Provide them now if available.'}</p>}
      </fieldset>}
    </details>
    {remove && <button type="button" className="club-button quiet" onClick={remove} aria-label={`${removeLabel} for ${player.has_details && name.trim() ? name : `Player ${index + 1}`}`}>{removeLabel}</button>}
  </div>
}
