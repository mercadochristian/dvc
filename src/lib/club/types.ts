export const LEVEL_LABEL = { developmental: 'Developmental', developmental_plus: 'Developmental Plus', intermediate: 'Intermediate', intermediate_plus: 'Intermediate Plus', advanced: 'Advanced' } as const
export const GENDER_LABEL = { male: 'Male', female: 'Female', prefer_not_to_say: 'Prefer not to say' } as const
export interface PlayerProfile { level: keyof typeof LEVEL_LABEL | null; age: number | null; birth_date: string | null; gender: keyof typeof GENDER_LABEL | null }
export const POSITIONS = ['open', 'opposite', 'middle', 'setter'] as const
export type ClubPosition = typeof POSITIONS[number]
export const POSITION_LABEL: Record<ClubPosition, string> = {
  open: 'Open Spiker', opposite: 'Opposite', middle: 'Middle Blocker', setter: 'Setter',
}
export type StaffRole = 'player' | 'developer' | 'admin' | 'coordinator' | 'facilitator'
export interface ClubGame {
  id: string; venue: string; city: string; maps_url?: string | null; venue_id?: string; team_count?: number; available_teams?: number; held_teams?: number[]; facilitators?: GameFacilitator[]; starts_at: string; ends_at: string
  status: 'draft' | 'published' | 'cancelled' | 'completed'; team_price: number
  positions: { position: ClubPosition; capacity: number; price: number; available: number }[]
}
export interface RosterEntry extends Partial<PlayerProfile> {
  id: string; name: string | null; position: ClubPosition; team: number | null
  game_id?: string; booking_id?: string; kind?: string; version?: number; is_registrant?: boolean
}
export interface Booking {
  id: string; game_id: string; kind: 'individual' | 'team'; captain_name: string; amount: number
  status: 'holding' | 'reserved' | 'cancelled' | 'rejected' | 'expired'
  payment_status: 'pending' | 'approved' | 'rejected'; expires_at: string; created_at: string
  venue?: string; maps_url?: string | null; starts_at?: string; ends_at?: string; entries?: RosterEntry[]
  contact?: string; receipt?: { id: string; review_note: string | null } | null
}
export interface PaymentMethod { id: string; label: string; account_name: string; account_number: string; qr_path: string | null; enabled: boolean }
export interface AccessEntry { id: string; email: string; role: 'developer' | 'admin' | 'coordinator' | 'facilitator'; enabled: boolean; registered?: boolean }
export interface ClubSession { configured: boolean; user: { id: string; name: string; email: string } | null; role: StaffRole; developer: boolean }
export interface Venue { id: string; name: string; city: string; enabled: boolean; maps_url?: string | null }
export interface GameFacilitator { user_id?: string; name: string }
export interface StaffMember { id: string; name: string; email: string; role: StaffRole }
export interface SupportRegistration { id: string; game_id: string; captain_name: string; contact: string; kind: 'individual' | 'team'; status: string }
export interface Workspace { role: StaffRole; games: ClubGame[]; roster: RosterEntry[]; access?: AccessEntry[]; payments?: PaymentMethod[]; bookings?: Booking[]; venues?: Venue[]; staff?: StaffMember[]; support?: SupportRegistration[] }
export interface DeveloperEvent { id: string; reference_id: string; actor_id: string | null; kind: 'activity' | 'error'; action: string; entity_id: string | null; details: Record<string, unknown>; created_at: string }
