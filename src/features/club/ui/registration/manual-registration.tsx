'use client'

import { useEffect, useRef, useState, useId, type FormEvent } from 'react'
import { act, read, RequestError } from '@/features/club/api/client'
import { checkoutPlayerErrors, type ContactErrors } from '@/features/club/model/checkout-fields'
import {
  addCheckoutPlayer, additionalPlayerPosition, changeOrganizerParticipation, checkoutCapacityWarning,
  checkoutDraftFrom, checkoutFormEstimate, initialCheckoutForm, missingTeamPositions, playerPositionAvailability,
  registrationKind, removeCheckoutPlayer, teamAvailable, type CheckoutForm, type CheckoutGameForm,
} from '@/features/club/model/checkout-form'
import { registrationContact } from '@/features/club/model/validation'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import { POSITION_LABEL, type CheckoutDraft, type ClubGame, type SelectedGamesPage } from '@/features/club/model/types'
import { ErrorNotice, Modal } from '../shared/primitives'
import { RequiredMark, RequiredNote } from '../shared/required'
import { CheckoutPlayer } from './checkout-player'
import styles from './manual-registration.module.css'
import wizard from './checkout-wizard.module.css'

function openGames(games: ClubGame[]) {
  return games.filter(game => game.status === 'published' && Date.parse(game.starts_at) > Date.now())
}

export function ManualRegistration({ games, close, saved }: { games: ClubGame[]; close: () => void; saved: () => void }) {
  const eligible = openGames(games)
  const [selectedId, setSelectedId] = useState(() => eligible[0]?.id)
  const [draft, setDraft] = useState<CheckoutForm>({ organizer: { name: '', contact: '', email: '' }, games: [] })
  const [expanded, setExpanded] = useState<string>()
  const [revision, refreshAvailability] = useState(0)
  const [availability, setAvailability] = useState<{ gameId: string; revision: number; game?: ClubGame; error?: unknown }>()
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<CheckoutDraft | null>(null)
  const submitting = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const fieldId = useId()
  const [contactErrors, setContactErrors] = useState<ContactErrors>({})

  function focusField(selector: string) {
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(selector)?.focus())
  }
  const selected = games.find(item => item.id === selectedId)
  const snapshot = availability?.gameId === selectedId ? availability : undefined
  const entry = draft.games.find(item => item.game.id === selectedId)
  const current = snapshot?.game && entry ? { ...entry, game: snapshot.game } : null
  const loading = Boolean(selectedId && snapshot?.revision !== revision)

  useEffect(() => {
    if (!selectedId) return
    let active = true
    void read<SelectedGamesPage>('selected-games', { ids: selectedId }).then(page => {
      if (!active) return
      const game = page.games.find(item => item.id === selectedId)
      if (!game) throw new Error('This game is no longer open for registration.')
      const [initial] = initialCheckoutForm([game], { configured: true, user: null, role: 'player', developer: false }).games
      setDraft(value => value.games.some(item => item.game.id === selectedId) ? value : { ...value, games: [...value.games, initial] })
      setExpanded(value => value ?? initial.players[0]?.form_id)
      setAvailability({ gameId: selectedId, revision, game })
    }).catch(failure => {
      if (active) setAvailability({ gameId: selectedId, revision, error: failure })
    })
    return () => { active = false }
  }, [selectedId, revision])
  const kind = current ? registrationKind(current.players.length) : null
  const capacity = current ? checkoutCapacityWarning(current) : null
  const missing = current && kind === 'team' ? missingTeamPositions(current) : []
  const nextPosition = current && additionalPlayerPosition(current)
  const amount = current ? checkoutFormEstimate(current) : 0

  function updateGame(next: CheckoutGameForm) {
    setDraft(value => ({ ...value, games: value.games.map(item => item.game.id === next.game.id ? next : item) }))
    setError(null)
  }

  function updateOrganizer(changes: Partial<CheckoutForm['organizer']>) {
    setDraft(value => ({ ...value, organizer: { ...value.organizer, ...changes } }))
    setContactErrors(errors => ({
      name: changes.name === undefined ? errors.name : undefined,
      contact: changes.contact === undefined ? errors.contact : undefined,
    }))
    setError(null)
  }

  async function reserve(request: CheckoutDraft) {
    if (submitting.current) return
    submitting.current = true
    setError(null)
    setBusy(true)
    try {
      const result = await act('manual.register', request)
      if (typeof result.id !== 'string' || !result.id) throw new Error('The reservation result could not be confirmed.')
      setPending(null)
      saved()
    } catch (failure) {
      const status = failure instanceof RequestError ? failure.status : undefined
      // A denial before the RPC cannot establish the outcome of an earlier
      // attempt whose response was lost. Keep its original payload for retry.
      setPending(pending || (status !== undefined && status >= 400 && status < 500 ? null : request))
      setError(failure)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!current || loading || capacity || missing.length) return
    const errors: ContactErrors = {}
    if (!draft.organizer.name.trim()) errors.name = 'Enter the organizer’s name.'
    try {
      registrationContact(draft.organizer.contact)
    } catch {
      errors.contact = 'Enter a valid email or Facebook/Messenger link.'
    }
    setContactErrors(errors)
    if (errors.name || errors.contact) {
      focusField(errors.name ? '[name="organizer-name"]' : '[name="organizer-contact"]')
      return
    }
    setAttempted(true)
    const incomplete = current.players.find(player => Object.keys(checkoutPlayerErrors(player, draft.organizer.name)).length > 0)
    if (incomplete) {
      setExpanded(incomplete.form_id)
      focusField(`[data-player-id="${incomplete.form_id}"] [aria-invalid="true"]`)
      return
    }
    try {
      const request = checkoutDraftFrom({ ...draft, games: [current] }, crypto.randomUUID())
      const game = current.game
      const positionPrices = Object.fromEntries(game.positions
        .filter(slot => current.players.some(player => player.position === slot.position))
        .map(slot => [slot.position, slot.discount_price ?? slot.price]))
      void reserve({
        ...request,
        games: [{
          ...request.games[0],
          expected_amount: amount,
          expected_quote: {
            venue: game.venue, city: game.city, maps_url: game.maps_url ?? null,
            starts_at: game.starts_at, ends_at: game.ends_at,
            team_price: game.team_discount_price ?? game.team_price,
            position_prices: positionPrices,
          },
        }],
      })
    } catch (failure) {
      setError(failure)
    }
  }

  return <Modal title="Add registration" close={close} dismissible={!busy && !pending} className={wizard.dialog}>
    <ErrorNotice error={error} />
    {pending ? <div className="club-form">
      <p role="status">The reservation result is uncertain. Retry the same request or check the game roster before adding another registration.</p>
      <div className="club-actions">
        <button type="button" className="club-button primary" disabled={busy} onClick={() => void reserve(pending)}>{busy ? 'Checking…' : 'Retry registration'}</button>
        <button type="button" className="club-button" disabled={busy} onClick={saved}>Close and refresh roster</button>
      </div>
    </div> : !selected ? <p className="club-note">There are no upcoming games open for registration.</p> : <div className="club-form">
      {eligible.length > 1 ? <label><span>Game<RequiredMark /></span><select required disabled={busy} value={selected.id} onChange={event => {
        setSelectedId(event.target.value)
        setExpanded(draft.games.find(item => item.game.id === event.target.value)?.players[0]?.form_id)
        setError(null)
      }}>
        {eligible.map(item => {
          const display = current?.game.id === item.id ? current.game : item
          return <option key={item.id} value={item.id}>{display.venue} · {dateLabel(display.starts_at)} · {timeLabel(display.starts_at)}</option>
        })}
      </select></label> : null}
      {current ? <p className="club-subtitle">{current.game.venue} · {current.game.city} · {dateLabel(current.game.starts_at)} · {timeLabel(current.game.starts_at)}–{timeLabel(current.game.ends_at)}</p>
        : <p className="club-subtitle">{selected.venue} · {dateLabel(selected.starts_at)} · {timeLabel(selected.starts_at)}</p>}
      {loading && <p role="status">Checking available slots…</p>}
      {!loading && snapshot?.error != null && <>
        <ErrorNotice error={snapshot.error} />
        <button type="button" className="club-button" onClick={() => refreshAvailability(value => value + 1)}>Retry availability</button>
      </>}
      {current && <form ref={formRef} className={`club-checkout-form ${wizard.form}`} onSubmit={submit} noValidate>
        <fieldset className={'club-form ' + styles.fields} disabled={busy || loading}>
          <RequiredNote />
          <div className="club-form-grid">
            <label><span>Organizer name<RequiredMark /></span>
              <input name="organizer-name" required value={draft.organizer.name} maxLength={100}
                aria-invalid={Boolean(contactErrors.name)} aria-describedby={contactErrors.name ? `${fieldId}-name-error` : undefined}
                onChange={event => updateOrganizer({ name: event.target.value })} />
              {contactErrors.name && <span id={`${fieldId}-name-error`} className={wizard.errorSummary}>{contactErrors.name}</span>}
            </label>
            <label><span>Email or Messenger link<RequiredMark /></span>
              <input name="organizer-contact" required value={draft.organizer.contact} maxLength={160}
                aria-invalid={Boolean(contactErrors.contact)} aria-describedby={contactErrors.contact ? `${fieldId}-contact-error` : undefined}
                onChange={event => updateOrganizer({ contact: event.target.value })} />
              {contactErrors.contact && <span id={`${fieldId}-contact-error`} className={wizard.errorSummary}>{contactErrors.contact}</span>}
            </label>
          </div>
          <label className="club-check"><input type="checkbox" checked={current.organizer_plays} onChange={event => {
            const next = changeOrganizerParticipation(current, event.target.checked)
            if (next === current) setError(new Error('No available player slot can include the organizer. Remove a player or change their position.'))
            else updateGame(next)
          }} /> Organizer is also playing</label>
          <div className="club-checkout-people">
            {current.players.map((player, index) => <CheckoutPlayer
              key={player.form_id}
              player={player}
              index={index}
              kind={kind ?? 'individual'}
              organizerName={draft.organizer.name}
              updateOrganizerName={name => updateOrganizer({ name })}
              game={current.game}
              availability={playerPositionAvailability(current, index)}
              compact
              manual
              expanded={expanded === player.form_id}
              onExpandedChange={open => setExpanded(value => open ? player.form_id : value === player.form_id ? undefined : value)}
              validationAttempted={attempted}
              update={changes => updateGame({ ...current, players: current.players.map((item, i) => i === index ? { ...item, ...changes } : item) })}
              remove={current.players.length > 1 && !player.is_registrant ? () => updateGame(removeCheckoutPlayer(current, index)) : undefined}
            />)}
          </div>
          <button type="button" className="club-button" disabled={!nextPosition} onClick={() => {
            const next = addCheckoutPlayer(current)
            updateGame(next)
            const added = next.players.at(-1)
            if (added) {
              setExpanded(added.form_id)
              focusField(`[data-player-id="${added.form_id}"] select`)
            }
          }}>Add player</button>
          {!nextPosition && !capacity && <p className="club-note">{current.players.length >= 5 && !teamAvailable(current.game)
            ? 'No team slot is available. Keep up to five players or choose another game.'
            : 'All available positions are included.'}</p>}
          {missing.length > 0 && <p role="status" className="club-note">Team needs {missing.map(position => POSITION_LABEL[position]).join(', ')}.</p>}
          {capacity && <p role="status" className="club-note">{capacity}</p>}
          <footer className={`${wizard.footer} ${styles.footer}`}>
            <p className={wizard.total}><strong>{kind === 'team' ? 'Team' : kind === 'group' ? 'Group' : 'Individual'} · {money(amount)}</strong></p>
            <p className="club-note">Slots are reserved immediately. Payment stays pending until staff review the receipt.</p>
            {error instanceof RequestError && error.status === 409 && <button type="button" className="club-button" onClick={() => {
              refreshAvailability(value => value + 1)
              setError(null)
            }}>Refresh availability</button>}
            <div className={wizard.navigation}><button type="submit" className="club-button primary" disabled={Boolean(capacity || missing.length)}>{busy ? 'Reserving…' : 'Reserve slots'}</button></div>
          </footer>
        </fieldset>
      </form>}
    </div>}
  </Modal>
}
