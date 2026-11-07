import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CheckoutProgress } from '@/features/club/ui/registration/checkout-progress'
import { CheckoutDetails } from '@/features/club/ui/registration/checkout-details'
import { initialCheckoutForm } from '@/features/club/model/checkout-form'
import { POSITIONS, type ClubGame } from '@/features/club/model/types'
const game: ClubGame = { id: '11111111-1111-4111-8111-111111111111', venue: 'Court', city: 'Test', status: 'published', starts_at: '2099-11-05T10:00:00Z', ends_at: '2099-11-05T12:00:00Z', team_price: 150000, positions: POSITIONS.map(position => ({ position, available: 2, capacity: 2, price: 30000 })) }
const noop = () => undefined

describe('registration phase and grouping semantics', () => {
  it.each(['Contact', 'Players', 'Review', 'Payment'] as const)('announces only %s as the current phase', phase => {
    const html = renderToStaticMarkup(<CheckoutProgress phase={phase} />)
    expect(html).toContain('aria-label="Registration progress"')
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
    expect(html).toContain(`aria-current="step"><span>${phase}</span></li>`)
  })
  it('retains the Organizer group and exact field names while showing one contact heading', () => {
    const value = initialCheckoutForm([game], { configured: true, user: null, role: 'player', developer: false })
    const html = renderToStaticMarkup(<CheckoutDetails value={value} update={noop} signedIn={false} busy={false} submit={noop} step={{ kind: 'contact' }} navigate={noop} />)
    expect(html.match(/>Your contact details<\/h3>/g)).toHaveLength(1)
    expect(html).toContain('<legend class="club-sr-only">Organizer</legend>')
    for (const name of ['Name', 'Email']) expect(html).toContain(`aria-label="${name}"`)
    expect(html).toContain('aria-label="Registration total"')
    expect(html).not.toContain('data-checkout-game-id')
  })
})
