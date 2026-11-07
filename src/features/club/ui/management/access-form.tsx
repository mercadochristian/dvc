'use client'
import { type AccessEntry } from '@/features/club/model/types'
export function AccessForm({ entry, busy, developer = false, save }: { entry?: AccessEntry; busy: boolean; developer?: boolean; save: (data: unknown) => void }) {
  return <form className="club-access-row" aria-label={entry?.email || 'Add staff email'} onSubmit={event => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    save({ ...(entry ? { id: entry.id } : {}), email: data.get('email'), role: data.get('role'), enabled: data.get('enabled') === 'on' })
  }}>
    <label>Email{entry && <small>{entry.registered ? 'Registered account' : 'Applied when they sign in'}</small>}<input disabled={entry?.role === 'developer' && !developer} name="email" type="email" required maxLength={254} defaultValue={entry?.email} /></label>
    <label>Role<select disabled={entry?.role === 'developer' && !developer} name="role" defaultValue={entry?.role || 'facilitator'}><option value="facilitator">Facilitator</option><option value="coordinator">Coordinator</option><option value="admin">Administrator</option>{(developer || entry?.role === 'developer') && <option value="developer">Developer</option>}</select></label>
    <label className="club-check"><input disabled={entry?.role === 'developer' && !developer} type="checkbox" name="enabled" defaultChecked={entry?.enabled ?? true} /> Enabled</label>
    <button className="club-button" disabled={busy || (entry?.role === 'developer' && !developer)}>{entry ? 'Save' : 'Add email'}</button>
  </form>
}
