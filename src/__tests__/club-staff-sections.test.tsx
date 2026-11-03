import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PaymentReview, StaffGames, StaffRoster } from '@/components/club/staff-sections'
import { GameEditor, ManualRegistration } from '@/components/club/staff-forms'
import { POSITIONS, type Booking, type ClubGame, type Workspace } from '@/lib/club/types'

const game: ClubGame = {
  id: '11111111-1111-4111-8111-111111111111', venue: 'Fixture Court', city: 'Makati',
  starts_at: '2026-11-03T18:00:00Z', ends_at: '2026-11-03T20:00:00Z', status: 'published', team_price: 165000,
  positions: POSITIONS.map(position => ({ position, capacity: 4, available: 4, price: 30000 })),
}
const workspace: Workspace = { role: 'admin', games: [game], roster: [{ id: 'player', booking_id: 'booking', game_id: game.id, name: null, position: 'setter', team: null }] }
const booking: Booking = { id: 'booking', game_id: game.id, captain_name: 'Fixture Player', kind: 'individual', amount: 30000, payment_status: 'pending', status: 'reserved', created_at: '2026-11-01', expires_at: '2026-11-02', receipt: { id: 'receipt', review_note: null } }
const noop = () => undefined
const action = async () => undefined

function games(value = workspace) {
  return renderToStaticMarkup(<StaffGames workspace={value} busy={false} roster={noop} edit={noop} cancel={noop} />)
}
function payment(value = booking) {
  return renderToStaticMarkup(<PaymentReview booking={value} games={[game]} methods={[]} busy={false} action={action} transfer={noop} saved={noop} />)
}
afterEach(() => vi.useRealTimers())

describe('staff games', () => {
  it('retains coordinator roster access', () => expect(games({ ...workspace, role: 'coordinator' })).toContain('>Roster</button>'))
  it('does not expose game editing to facilitators', () => expect(games({ ...workspace, role: 'facilitator' })).not.toContain('>Edit</button>'))
  it('does not expose game cancellation to facilitators', () => expect(games({ ...workspace, role: 'facilitator' })).not.toContain('>Cancel</button>'))
  it('retains admin editing', () => expect(games()).toContain('>Edit</button>'))
  it('keeps cancelled games closed to editing', () => expect(games({ ...workspace, games: [{ ...game, status: 'cancelled' }] })).not.toContain('>Edit</button>'))
  it('keeps table headers accessible in the mobile layout', () => expect(games()).toContain('<th scope="col">Actions</th>'))
  it('labels the player count for narrow layouts', () => expect(games()).toContain('data-label="Players"'))
  it('renders an empty state when no games exist', () => expect(games({ ...workspace, games: [] })).toContain('No games yet.'))
})
describe('staff roster and payment controls', () => {
  it('retains unnamed teammate cards', () => expect(renderToStaticMarkup(<StaffRoster workspace={workspace} selected={game.id} select={noop} busy={false} save={action} />)).toContain('Player to be named'))
  it('renders fixed position slots instead of arbitrary team numbers', () => expect(renderToStaticMarkup(<StaffRoster workspace={workspace} selected={game.id} select={noop} busy={false} save={action} />)).toContain('aria-label="Assign Setter to Team 1"'))
  it('offers approval only for pending submitted receipts', () => expect(payment()).toContain('>Approve</button>'))
  it('does not re-offer approval after review', () => expect(payment({ ...booking, payment_status: 'approved' })).not.toContain('>Approve</button>'))
  it('does not offer approval without a receipt', () => expect(payment({ ...booking, receipt: null })).not.toContain('>Approve</button>'))
  it('preserves receipt links', () => expect(payment()).toContain('/api/club/asset?kind=receipt&amp;id=booking'))
  it('keeps transfer available separately from review', () => expect(payment()).toContain('>Transfer</button>'))
})
describe('staff editor data', () => {
  it('preserves the game team price', () => expect(renderToStaticMarkup(<GameEditor game={game} close={noop} saved={noop} />)).toMatch(/name="team_price"[^>]*value="1650"/))
  it('shows Manila game dates in manual registration', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
    expect(renderToStaticMarkup(<ManualRegistration games={[game]} close={noop} saved={noop} />)).toContain('Wed, Nov 4')
  })
})
