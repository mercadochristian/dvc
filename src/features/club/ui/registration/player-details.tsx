'use client'
import { useState } from 'react'
import { manilaDate } from '@/features/club/model/format'
import { LEVEL_LABEL, GENDER_LABEL, type PlayerProfile } from '@/features/club/model/types'
import { RequiredMark } from '../shared/required'

export function PlayerDetails({ prefix = '', required = true, value, gameDate }: { prefix?: string; required?: boolean; value?: Partial<PlayerProfile>; gameDate?: string }) {
  const [birthDate, setBirthDate] = useState(value?.birth_date || '')
  const [firstTimer, setFirstTimer] = useState<boolean | null>(value?.first_timer ?? null)
  const today = manilaDate(new Date())
  const targetDate = gameDate && Number.isFinite(Date.parse(gameDate)) ? (/^\d{4}-\d{2}-\d{2}$/.test(gameDate) ? gameDate : manilaDate(new Date(gameDate))) : today
  return <div className="club-player-details">
    <div className="club-form-grid">
      <label><span>Level{required && <RequiredMark />}</span><select name={`${prefix}level`} required={required} defaultValue={value?.level || ''}><option value="">Choose level</option>{Object.entries(LEVEL_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label><span>Gender{required && <RequiredMark />}</span><select name={`${prefix}gender`} required={required} defaultValue={value?.gender || ''}><option value="">Choose option</option>{Object.entries(GENDER_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <label><span>Birthday{required && <RequiredMark />}</span><input type="date" name={`${prefix}birth_date`} required={required} max={today < targetDate ? today : targetDate} value={birthDate} onChange={event => setBirthDate(event.target.value)} /></label>
    {!required && !value?.birth_date && value?.age !== null && value?.age !== undefined && <input type="hidden" name={`${prefix}age`} value={birthDate ? '' : value.age} />}
    {!required && !birthDate && <p className="club-note">Birthday was not recorded for this player. Existing details can be kept without inventing a birthday.</p>}
    <fieldset className="club-choice"><legend>First time playing with DVC?{required && <RequiredMark />}</legend>
      <label><input type="radio" name={`${prefix}first_timer`} value="true" required={required} checked={firstTimer === true} onChange={() => setFirstTimer(true)} /> First-timer</label>
      <label><input type="radio" name={`${prefix}first_timer`} value="false" required={required} checked={firstTimer === false} onChange={() => setFirstTimer(false)} /> Returnee</label>
    </fieldset>
  </div>
}
export function BalancingNote() { return <p className="club-note club-balancing-note">Birthday, level and gender help staff balance teams. Age is calculated for the game date.</p> }
