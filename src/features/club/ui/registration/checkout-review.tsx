'use client'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import type { CheckoutDraft, CheckoutQuote } from '@/features/club/model/types'
import { POSITION_LABEL } from '@/features/club/model/types'
import { CheckoutProgress } from './checkout-progress'
import styles from './checkout-wizard.module.css'
import { VenueLink } from '../shared/venue-link'

export function CheckoutReview({ draft, quote, busy, guest = false, edit, editContact, confirm }: {
  draft: CheckoutDraft; quote: CheckoutQuote; busy: boolean; guest?: boolean; edit: () => void; editContact?: () => void; confirm: () => void
}) {
  return <section className={`club-form club-checkout-review ${styles.flow}`} aria-label="Registration review">
    <CheckoutProgress phase="Review" links={busy ? undefined : { Contact: editContact, Players: edit }} />
    <div className={styles.sectionHeading}><h3>Review your registration</h3><p className="club-note">Check each game, player and price before reserving your slots.</p></div>
    <div className={styles.guestStrip}><strong>Organizer · {draft.organizer.name}</strong><p className="club-note">{draft.organizer.contact}</p></div>
    {quote.games.map(game => <section className={`club-checkout-game ${styles.reviewPanel}`} key={game.game_id}>
      <header><div><h3><VenueLink name={game.venue} mapsUrl={game.maps_url} /></h3><p className="club-note">{dateLabel(game.starts_at)} · {timeLabel(game.starts_at)}–{timeLabel(game.ends_at)}</p></div></header>
      <p><strong>{game.kind === 'team' ? `Team · ${game.players.length} players` : game.kind === 'group' ? `Group of ${game.players.length}` : 'Individual'}</strong>{!game.organizer_plays && <span className="club-note"> · Organizer not playing</span>}</p>
      <ul className="club-checkout-player-review">{game.players.map((player, index) => <li key={index}><span>{player.name || 'Player to be named'}{player.is_registrant ? ' · You' : ''}<small>{POSITION_LABEL[player.position]}{player.has_details === false ? ' · Position only' : ''}</small></span>{game.kind !== 'team' && <strong>{money(game.quote.position_prices[player.position] ?? 0)}</strong>}</li>)}</ul>
      <div className="club-total"><span>{game.kind === 'team' ? 'Team total' : 'Game subtotal'}</span><strong>{money(game.amount)}</strong></div>
    </section>)}
    <div className={styles.checkoutSummary}>
    <div className="club-total"><span>Checkout total</span><strong>{money(quote.amount)}</strong></div>
    <p className="club-note">Register starts a 10-minute hold once your slots are confirmed.</p>
    {guest && <p className="club-note">Guest bookings stay in this browser. Keep your booking reference.</p>}
    <div className="club-actions"><button type="button" className="club-button" disabled={busy} onClick={edit}>Edit details</button><button type="button" className="club-button primary" disabled={busy} onClick={confirm}>{busy ? 'Reserving…' : 'Register'}</button></div>
    </div>
  </section>
}
