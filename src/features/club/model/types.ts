export const LEVEL_LABEL = { developmental: 'Developmental', developmental_plus: 'Developmental Plus', intermediate: 'Intermediate', intermediate_plus: 'Intermediate Plus', advanced: 'Advanced' } as const
export const GENDER_LABEL = { male: 'Male', female: 'Female', prefer_not_to_say: 'Prefer not to say' } as const
export interface PlayerProfile { level: keyof typeof LEVEL_LABEL | null; age: number | null; birth_date: string | null; gender: keyof typeof GENDER_LABEL | null; first_timer?: boolean | null }
export const POSITIONS = ['open', 'opposite', 'middle', 'setter'] as const
export type ClubPosition = typeof POSITIONS[number]
export const POSITION_LABEL: Record<ClubPosition, string> = {
  open: 'Open Spiker', opposite: 'Opposite', middle: 'Middle Blocker', setter: 'Setter',
}
export type StaffRole = 'player' | 'developer' | 'admin' | 'coordinator' | 'facilitator'
export interface ClubGame {
  id: string; venue: string; city: string; maps_url?: string | null; venue_id?: string; team_count?: number; available_teams?: number; held_teams?: number[]; facilitators?: GameFacilitator[]; starts_at: string; ends_at: string
  status: 'draft' | 'published' | 'cancelled' | 'completed'; team_price: number; regular_team_price?: number; team_discount_price?: number | null
  positions: { position: ClubPosition; capacity: number; price: number; regular_price?: number; discount_price?: number | null; available: number }[]
}
export interface RosterEntry extends Partial<PlayerProfile> {
  id: string; name: string | null; position: ClubPosition; team: number | null
  game_id?: string; booking_id?: string; kind?: string; version?: number; is_registrant?: boolean; has_details?: boolean | null; email?: string | null
}
export interface Booking {
  id: string; game_id: string; kind: 'individual' | 'group' | 'team'; captain_name: string; amount: number; organizer_plays?: boolean; checkout_id?: string | null
  checkout_amount?: number; checkout_status?: Checkout['status']; checkout_payment_status?: Checkout['payment_status']; checkout_expires_at?: string
  status: 'holding' | 'reserved' | 'cancelled' | 'rejected' | 'expired'
  payment_status: 'pending' | 'approved' | 'rejected'; expires_at: string; created_at: string
  venue?: string; maps_url?: string | null; starts_at?: string; ends_at?: string; game_status?: ClubGame['status']; entries?: RosterEntry[]
  contact?: string; organizer_email?: string | null; manual?: boolean; receipt?: { id: string; review_note: string | null } | null
}
export type RegistrationKind = 'individual' | 'group' | 'team'
export interface CheckoutPlayerInput extends Partial<PlayerProfile> {
  position: ClubPosition; name: string | null; is_registrant: boolean; has_details?: boolean; email?: string | null
}
export interface CheckoutPriceSnapshot {
  venue: string; city: string; maps_url: string | null; starts_at: string; ends_at: string
  team_price: number; position_prices: Partial<Record<ClubPosition, number>>
}
export interface CheckoutGameInput {
  game_id: string; kind: RegistrationKind; organizer_plays: boolean; players: CheckoutPlayerInput[]
  expected_amount?: number; expected_quote?: CheckoutPriceSnapshot
}
export interface CheckoutDraft {
  request_id: string; organizer: { name: string; contact: string; email: string | null }; games: CheckoutGameInput[]
}
export interface CheckoutQuoteGame extends CheckoutGameInput {
  amount: number; venue: string; city: string; maps_url: string | null; starts_at: string; ends_at: string; quote: CheckoutPriceSnapshot
}
export interface CheckoutQuote { games: CheckoutQuoteGame[]; amount: number }
export interface CheckoutConflict { game_id: string; code: 'SELECTION_UNAVAILABLE' | 'PRICE_CHANGED' | 'SCHEDULE_CHANGED' | 'SKILL_CHANGED' }
export interface Checkout {
  request_id: string; id: string; status: 'holding' | 'reserved' | 'expired' | 'cancelled'; payment_status: 'pending' | 'approved'
  expires_at: string; amount: number; bookings: Booking[]; created_at: string
  receipt?: { id: string; submitted_at: string } | null
}
export interface PaymentMethod { id: string; label: string; account_name: string; account_number: string; qr_path: string | null; enabled: boolean }
export interface AccessEntry { id: string; email: string; role: 'developer' | 'admin' | 'coordinator' | 'facilitator'; enabled: boolean; registered?: boolean }
export interface ClubSession { configured: boolean; user: { id: string; name: string; email: string } | null; role: StaffRole; developer: boolean }
export interface Venue { id: string; name: string; city: string; enabled: boolean; maps_url?: string | null }
export interface GameFacilitator { user_id?: string; name: string }
export interface StaffMember { id: string; name: string; email: string; role: StaffRole }
export interface SupportRegistration { id: string; game_id: string; captain_name: string; contact: string; kind: RegistrationKind; status: string }
export interface RegistrationProfile extends PlayerProfile { saved?: boolean; name: string; contact: string; position: ClubPosition | null }
export interface ClubUser { id: string; name: string; email: string; role: StaffRole; verified: boolean }
export interface Announcement { id: string; title: string; body: string; enabled: boolean; updated_at: string; publish_at: string | null; ends_at: string | null }
export interface Workspace { role: StaffRole; limited_options?: boolean; games: ClubGame[]; roster: RosterEntry[]; access?: AccessEntry[]; payments?: PaymentMethod[]; bookings?: Booking[]; venues?: Venue[]; staff?: StaffMember[]; support?: SupportRegistration[]; users?: ClubUser[]; announcements?: Announcement[] }
export interface DeveloperEvent { id: string; reference_id: string; actor_id: string | null; kind: 'activity' | 'error'; action: string; entity_id: string | null; details: Record<string, unknown>; created_at: string }
export const DEVELOPER_LOG_PAGE_SIZE = 100
export interface DeveloperLogPage { events: DeveloperEvent[]; next_cursor: string | null }

export interface PublicGameVenue { id: string; name: string; city: string }
export interface PublicGameVenuesPage { venues: PublicGameVenue[]; next_cursor: string | null }
export interface GamesPage { games: ClubGame[]; as_of: string; next_cursor: string | null }
export interface SelectedGamesPage { games: ClubGame[]; missing_ids: string[] }
