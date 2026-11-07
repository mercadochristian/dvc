import { describe, expect, it } from 'vitest'
import { editablePlayer, playerEditBlock, playerEditPayload } from '@/features/club/model/booking-player-edit'
import type { Booking, RosterEntry } from '@/features/club/model/types'

const start = Date.parse('2099-11-04T10:00:00Z'), cutoff = start - 3_600_000
const booking = { id: 'booking', game_id: 'game', captain_name: 'Organizer', kind: 'team', status: 'reserved', game_status: 'published', starts_at: new Date(start).toISOString(), expires_at: new Date(start).toISOString() } as Booking
const entry: RosterEntry = { id: 'entry', version: 4, position: 'open', name: 'Legacy player', team: null, birth_date: null, age: 27, first_timer: false }

describe('owner player detail edit window', () => {
  it('permits guidance strictly before the one-hour cutoff', () => expect(playerEditBlock(booking, cutoff - 1)).toBeNull())
  it('locks at the exact one-hour cutoff', () => expect(playerEditBlock(booking, cutoff)).toMatch(/locked/))
  it('locks after the cutoff', () => expect(playerEditBlock(booking, cutoff + 1)).toMatch(/locked/))
  it('denies a cancelled game even before cutoff', () => expect(playerEditBlock({ ...booking, game_status: 'cancelled' }, cutoff - 1)).not.toBeNull())
  it('fails closed without actual game status', () => expect(playerEditBlock({ ...booking, game_status: undefined }, cutoff - 1)).not.toBeNull())
  it('denies an expired hold even before game cutoff', () => expect(playerEditBlock({ ...booking, status: 'holding', expires_at: new Date(cutoff - 2).toISOString() }, cutoff - 1)).toMatch(/expired/))
  it('denies cancelled bookings', () => expect(playerEditBlock({ ...booking, status: 'cancelled' }, cutoff - 1)).not.toBeNull())
  it('does not fabricate birthdays from a historical age', () => expect(editablePlayer(entry).birth_date).toBe(''))
  it('preserves an explicit Returnee value', () => expect(editablePlayer(entry).first_timer).toBe(false))
  it('strips retained draft personal data when details are unchecked', () => {
    const payload = playerEditPayload(booking, entry, { ...editablePlayer(entry), has_details: false, name: 'Unsaved', birth_date: '2000-01-01' })
    expect(payload).toEqual({ booking_id: 'booking', entry_id: 'entry', expected_version: 4, has_details: false, name: null })
  })
  it('never submits position, team, price or participant-count changes', () => {
    const payload = playerEditPayload(booking, entry, { ...editablePlayer(entry), has_details: true, position: 'setter' })
    expect(Object.keys(payload).sort()).toEqual(['birth_date','booking_id','email','entry_id','expected_version','first_timer','gender','has_details','level','name'].sort())
  })
  it('fails closed without the row version', () => expect(() => playerEditPayload(booking, { ...entry, version: undefined }, editablePlayer(entry))).toThrow(/Refresh/))
})
