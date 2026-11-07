'use client'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { addCheckoutPlayer, additionalPlayerPosition, changeOrganizerParticipation, changePlayerPosition, checkoutCapacityWarning, checkoutFormEstimate, missingTeamPositions, playerPositionAvailability, registrationKind, removeCheckoutPlayer, teamAvailable, validTeamComposition, type CheckoutForm, type CheckoutGameForm, type CheckoutPlayerForm } from '@/features/club/model/checkout-form'
import { checkoutGameIssue, checkoutStepIndex, contactIssue, type CheckoutStep } from '@/features/club/model/checkout-wizard'
import { checkoutContactErrors, type ContactField } from '@/features/club/model/checkout-fields'
import styles from './checkout-wizard.module.css'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import { POSITION_LABEL, type RegistrationProfile } from '@/features/club/model/types'
import { RequiredMark, RequiredNote } from '../shared/required'
import { VenueLink } from '../shared/venue-link'
import { CheckoutProgress } from './checkout-progress'
import { CheckoutPlayer } from './checkout-player'

type PlayerStage = 'first' | 'choice' | 'additional'

export function CheckoutDetails({ value, update, profile, signedIn, busy, disabled = false, issues, submit, step, navigate, contactReached = false, activePlayer = {}, activatePlayer }: {
  value: CheckoutForm; update: (value: CheckoutForm) => void; profile?: RegistrationProfile | null; signedIn: boolean; busy: boolean
  disabled?: boolean; issues?: Record<string, string>; submit: () => void
  step: CheckoutStep; contactReached?: boolean; navigate: (step: CheckoutStep) => void
  activePlayer?: Record<string, string>; activatePlayer?: (gameId: string, playerId: string) => void
}) {
  const fieldId = useId()
  const [contactAttempted, setContactAttempted] = useState(false), [validatedGames, setValidatedGames] = useState<string[]>([])
  const contactErrors = contactAttempted ? checkoutContactErrors(value.organizer) : {}
  function contactField(field: ContactField, help?: string) { return { 'data-contact-field': field, 'aria-label': { name: 'Name', contact: 'Email' }[field], 'aria-invalid': contactErrors[field] ? true as const : undefined, 'aria-describedby': [help, contactErrors[field] ? `${fieldId}-${field}-error` : undefined].filter(Boolean).join(' ') || undefined } }
  function contactError(field: ContactField) { return contactErrors[field] ? <small className="club-selection-warning" id={`${fieldId}-${field}-error`}>{contactErrors[field]}</small> : null }
  const [stepError, setStepError] = useState(''), [fieldError, setFieldError] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null), footer = useRef<HTMLElement>(null)
  const [localActive, setLocalActive] = useState<Record<string, string>>({})
  const gameIndex = checkoutStepIndex(value, step), contact = gameIndex < 0
  const currentGame = value.games[gameIndex]
  const [playerStages, setPlayerStages] = useState<Record<string, PlayerStage>>({})
  const playerStage = currentGame
    ? playerStages[currentGame.game.id] ?? (currentGame.players.length > 1 ? 'additional' : 'first')
    : 'first'
  const choosingPlayers = !contact && playerStage === 'choice'

  function showPlayerStage(gameId: string, stage: PlayerStage) {
    if (stage === 'first') {
      const entry = value.games.find(game => game.game.id === gameId)
      const player = entry?.players.find(player => player.is_registrant) ?? entry?.players[0]
      if (player?.form_id) selectPlayer(gameId, player.form_id)
    }
    setStepError('')
    setPlayerStages(current => ({ ...current, [gameId]: stage }))
  }
  function changeContact(changes: Partial<CheckoutForm['organizer']>) { setStepError(''); update({ ...value, organizer: { ...value.organizer, ...changes } }) }
  function selectPlayer(gameId: string, playerId: string) { setLocalActive(current => ({ ...current, [gameId]: playerId })); activatePlayer?.(gameId, playerId) }
  function go(next: CheckoutStep) { setStepError(''); navigate(next) }
  useEffect(() => {
    const body = heading.current?.closest<HTMLElement>('.club-dialog-body')
    if (body) body.scrollTop = 0
    heading.current?.focus({ preventScroll: true })
  }, [step.kind, step.kind === 'game' ? step.gameId : '', playerStage])
  const [transitionError, setTransitionError] = useState<{ gameId: string; text: string } | null>(null)
  function gameUpdate(index: number, game: CheckoutGameForm) { setStepError(''); setTransitionError(null); update({ ...value, games: value.games.map((entry, gameIndex) => gameIndex === index ? game : entry) }) }
  const formRef = useRef<HTMLFormElement>(null), focusAfterEdit = useRef<{ gameId: string; playerId?: string } | null>(null)
  useEffect(() => {
    const target = focusAfterEdit.current
    if (!target) return
    focusAfterEdit.current = null
    const section = formRef.current?.querySelector<HTMLElement>(`[data-checkout-game-id="${target.gameId}"]`)
    const element = target.playerId ? section?.querySelector<HTMLElement>(`[data-player-id="${target.playerId}"] summary`) : section?.querySelector<HTMLElement>('[data-add-player]')
    const frame = requestAnimationFrame(() => element?.focus())
    return () => cancelAnimationFrame(frame)
  }, [value])
  useEffect(() => {
    const element = footer.current, body = formRef.current?.closest<HTMLElement>('.club-dialog-body')
    if (!element || !body) return
    const property = '--club-wizard-footer-height', previous = body.style.getPropertyValue(property)
    const measure = () => { const height = Math.ceil(element.getBoundingClientRect().height); if (height > 0) body.style.setProperty(property, `${height}px`) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect(); if (previous) body.style.setProperty(property, previous); else body.style.removeProperty(property) }
  }, [])
  function addPlayer(index: number) {
    const entry = value.games[index], changed = addCheckoutPlayer(entry)
    if (changed === entry) return
    showPlayerStage(entry.game.id, 'additional')
    focusAfterEdit.current = { gameId: entry.game.id, playerId: changed.players.at(-1)?.form_id }
    selectPlayer(entry.game.id, changed.players.at(-1)?.form_id || '')
    gameUpdate(index, changed)
  }
  function removePlayer(gameIndex: number, playerIndex: number) {
    const entry = value.games[gameIndex], changed = removeCheckoutPlayer(entry, playerIndex)
    if (changed === entry) return
    focusAfterEdit.current = { gameId: entry.game.id, playerId: changed.players[Math.min(playerIndex, changed.players.length - 1)]?.form_id }
    selectPlayer(entry.game.id, changed.players[Math.min(playerIndex, changed.players.length - 1)]?.form_id || '')
    gameUpdate(gameIndex, changed)
  }
  function chooseParticipation(index: number, plays: boolean) {
    const entry = value.games[index], changed = changeOrganizerParticipation(entry, plays, profile)
    if (plays !== entry.organizer_plays && changed === entry) setTransitionError({ gameId: entry.game.id, text: 'No available player slot can include you yet. Remove a player or choose another game. Existing player details will not be replaced.' })
    else gameUpdate(index, changed)
  }
  function playerUpdate(gameIndex: number, playerIndex: number, changes: Partial<CheckoutPlayerForm>) {
    const game = value.games[gameIndex]
    const changed = { ...game, players: game.players.map((player, index) => index === playerIndex ? { ...player, ...changes } : player) }
    gameUpdate(gameIndex, changes.position ? changePlayerPosition(changed, playerIndex, changes.position) : changed)
  }
  const cannotReview = !contact && (!currentGame || !validTeamComposition(currentGame) || Boolean(checkoutCapacityWarning(currentGame)))
  function validateGame(index: number): boolean {
    const entry = value.games[index], issue = checkoutGameIssue(value, entry)
    setValidatedGames(current => current.includes(entry.game.id) ? current : [...current, entry.game.id])
    if (!issue) return true
    if (entry.players.length > 1) showPlayerStage(entry.game.id, 'additional')
    else showPlayerStage(entry.game.id, 'first')
    setStepError(issue.message); setFieldError(Boolean(issue.field))
    if (issue.playerIndex !== undefined) {
      const playerId = entry.players[issue.playerIndex].form_id || ''
      selectPlayer(entry.game.id, playerId)
      requestAnimationFrame(() => {
        const section = formRef.current?.querySelector<HTMLElement>(`[data-checkout-game-id="${entry.game.id}"]`)
        const player = section?.querySelector<HTMLElement>(`[data-player-id="${playerId}"]`)
        const invalid = player?.querySelector<HTMLInputElement>('input:invalid, select:invalid, textarea:invalid')
        const specific = issue.field ? player?.querySelector<HTMLInputElement>(`[data-player-field="${issue.field}"]`) : null
        const semantic = issue.message.includes('email') ? player?.querySelector<HTMLInputElement>('input[type="email"]') : issue.message.includes('birthday') ? player?.querySelector<HTMLInputElement>('input[type="date"]') : null
        const target = specific || invalid || semantic || player?.querySelector<HTMLElement>('input, select, summary')
        target?.focus()
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) target.reportValidity()
      })
    }
    if (gameIndex !== index) navigate({ kind: 'game', gameId: entry.game.id })
    return false
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (contact) {
      setContactAttempted(true)
      const errors = checkoutContactErrors(value.organizer), field = Object.keys(errors)[0] as ContactField | undefined
      if (field) {
        setStepError(errors[field] || 'Check your contact details.'); setFieldError(true)
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-contact-field="${field}"]`)?.focus())
        return
      }
      if (!formRef.current?.reportValidity()) return
      const issue = contactIssue(value)
      if (issue) { setStepError(issue); return }
      for (let index = 0; index < value.games.length; index++) if (!validateGame(index)) return
      if (!disabled) submit()
      return
    }
    if (!validateGame(gameIndex)) return
    if (!formRef.current?.reportValidity()) return
    if (choosingPlayers) return
    if (playerStage === 'first') {
      showPlayerStage(currentGame.game.id, currentGame.players.length > 1 ? 'additional' : 'choice')
      return
    }
    advance()
  }
  function advance() {
    if (busy || !currentGame) return
    if (gameIndex < value.games.length - 1) { go({ kind: 'game', gameId: value.games[gameIndex + 1].game.id }); return }
    for (let index = 0; index < value.games.length; index++) if (!validateGame(index)) return
    go({ kind: 'contact' })
  }
  return <form noValidate ref={formRef} className={`club-form club-checkout-form ${styles.form}`} onSubmit={review}>
    <CheckoutProgress phase={contact ? 'Contact' : 'Players'} links={busy ? undefined : {
      ...(!contact && contactReached && value.games.every(game => !checkoutGameIssue(value, game)) && { Contact: () => go({ kind: 'contact' }) }),
      ...(contact && value.games[0] && { Players: () => go({ kind: 'game', gameId: value.games[0].game.id }) }),
    }} />
    {!contact && <h3 ref={heading} tabIndex={-1} className={styles.heading}>{choosingPlayers ? 'Register other players or a team?' : `Game ${gameIndex + 1} of ${value.games.length} · ${playerStage === 'first' && currentGame.organizer_plays ? 'Your player details' : 'Players'}`}</h3>}
    {choosingPlayers && <section className={styles.playerPanel} aria-label="Additional player choice">
      <p>For {currentGame.game.venue}. Choose Yes to add another position and enter player details if available.</p>
      {!additionalPlayerPosition(currentGame) && <p className="club-note">There are no additional positions available for this game.</p>}

    </section>}
    {!contact && stepError && <p className={styles.errorSummary} role="alert">{fieldError ? 'Check the highlighted fields.' : stepError}</p>}
    {!contact && playerStage === 'first' && gameIndex === 0 && !signedIn && <div className={styles.guestStrip}><span>Continue as guest</span><a href="/club/sign-in">Sign in</a></div>}
    {contact && <>
    <section className={styles.contactPanel} aria-labelledby={`${fieldId}-contact-heading`}>
      <header className={styles.panelHeader}><h3 id={`${fieldId}-contact-heading`} ref={heading} tabIndex={-1} className={styles.heading}>Your contact details</h3><RequiredNote /></header>
      {stepError && <p className={styles.errorSummary} role="alert">{fieldError ? 'Check the highlighted fields.' : stepError}</p>}
      <fieldset className="club-checkout-organizer"><legend className="club-sr-only">Organizer</legend>
      <label><span className="club-field-label">Name<RequiredMark /></span><input {...contactField('name')} autoComplete="name" required maxLength={100} value={value.organizer.name} onChange={event => changeContact({ name: event.target.value })} />{contactError('name')}</label>
      <div className="club-field">
        <label><span className="club-field-label">Email<RequiredMark /></span><input {...contactField('contact', `${fieldId}-contact-help`)} type="email" autoComplete="email" required readOnly={signedIn} maxLength={160} autoCapitalize="none" spellCheck={false} value={value.organizer.contact} onChange={event => changeContact({ contact: event.target.value, email: '' })} /></label>
        <small id={`${fieldId}-contact-help`}>{signedIn ? 'This is the email linked to your account.' : 'Use the email where you want to receive your confirmation.'} We use your information only for DVC club operations and related communications.</small>
        {contactError('contact')}
      </div>
      </fieldset>
    </section>
    </>}
    {value.games.map((entry, index) => ({ entry, index })).filter(({ index }) => !contact && !choosingPlayers && index === gameIndex).map(({ entry, index: gameIndex }) => {
      const kind = registrationKind(entry.players.length), missing = missingTeamPositions(entry), nextPosition = additionalPlayerPosition(entry)
      const firstPlayerIndex = Math.max(0, entry.players.findIndex(player => player.is_registrant))
      const countLabel = `${entry.players.length} player${entry.players.length === 1 ? '' : 's'}`
      const missingLabel = [...new Set(missing)].map(position => `${missing.filter(value => value === position).length} ${POSITION_LABEL[position]}`).join(', ')
      return <section className={`club-checkout-game ${styles.playerPanel}`} data-checkout-game-id={entry.game.id} key={entry.game.id} aria-label={`Registration for ${entry.game.venue}, ${dateLabel(entry.game.starts_at)}, ${timeLabel(entry.game.starts_at)}–${timeLabel(entry.game.ends_at)}`}>
      <header><div><h3><VenueLink name={entry.game.venue} mapsUrl={entry.game.maps_url} /></h3><p className="club-note">{dateLabel(entry.game.starts_at)} · {timeLabel(entry.game.starts_at)}–{timeLabel(entry.game.ends_at)}</p></div>{value.games.length > 1 && <button type="button" className="club-button quiet" onClick={() => { const games = value.games.filter((_, index) => index !== gameIndex); go({ kind: 'game', gameId: games[Math.min(gameIndex, games.length - 1)].game.id }); update({ ...value, games }) }} aria-label={`Remove ${entry.game.venue}, ${dateLabel(entry.game.starts_at)}, ${timeLabel(entry.game.starts_at)}–${timeLabel(entry.game.ends_at)} from checkout`}>Remove game</button>}</header>
      {playerStage === 'additional' && <strong>{countLabel} · {kind === 'team' ? 'Team registration' : kind === 'group' ? 'Group registration' : 'Individual registration'}</strong>}
      {kind === 'team' && <p className="club-note">Team minimum: 2 Open, 1 Opposite, 2 Middle, 1 Setter.</p>}
      {kind === 'team' && missing.length > 0 && <p className="club-selection-warning" role="status">Still needed for a team: {missingLabel}.</p>}
      {checkoutCapacityWarning(entry) && <p className="club-selection-warning" role="status">{checkoutCapacityWarning(entry)}</p>}
      {issues?.[entry.game.id] && <p className="club-selection-warning" role="alert">{issues[entry.game.id]}</p>}
      {transitionError?.gameId === entry.game.id && <p className="club-selection-warning" role="alert">{transitionError.text}</p>}
      <label className="club-check"><input type="checkbox" checked={entry.organizer_plays} onChange={event => chooseParticipation(gameIndex, event.target.checked)} /> I am playing in this game</label>
      {!entry.organizer_plays && <p className="club-note">You’re booking for someone else.</p>}
      <div className="club-checkout-people">{entry.players.map((player, playerIndex) => (playerStage === 'additional' || playerIndex === firstPlayerIndex) && <CheckoutPlayer compact skillLocked={signedIn && profile?.saved === true && player.is_registrant} validationAttempted={validatedGames.includes(entry.game.id)} expanded={(activePlayer[entry.game.id] ?? localActive[entry.game.id] ?? entry.players[0]?.form_id) === player.form_id} onExpandedChange={expanded => selectPlayer(entry.game.id, expanded ? player.form_id || '' : '')} key={player.form_id || playerIndex} player={player} index={playerIndex} kind={kind} organizerName={value.organizer.name} updateOrganizerName={name => changeContact({ name })} game={entry.game} availability={playerPositionAvailability(entry, playerIndex)} update={changes => playerUpdate(gameIndex, playerIndex, changes)} remove={playerStage === 'additional' && !player.is_registrant && entry.players.length > 1 ? () => removePlayer(gameIndex, playerIndex) : undefined} />)}</div>
      {playerStage === 'additional' && <div className="club-checkout-add-player"><button type="button" className="club-button" data-add-player disabled={!nextPosition} onClick={() => addPlayer(gameIndex)}>Add another player</button>{!nextPosition && <p className="club-note">{entry.players.length >= 5 && !teamAvailable(entry.game) ? 'A full team is not available. You can keep up to five players or choose another game.' : entry.game.status !== 'published' || Date.parse(entry.game.starts_at) <= Date.now() ? 'This game is no longer open. Remove it or choose another game.' : 'All available positions are included. Remove a player to make space.'}</p>}</div>}
    </section>})}
    <footer ref={footer} className={styles.footer} aria-label="Registration total">
      <div className={styles.total}><span>Estimated total</span><strong>{money(value.games.reduce((sum, entry) => sum + checkoutFormEstimate(entry), 0))}</strong></div>
      <div className={styles.navigation}>
        {(contact ? value.games.length > 0 : choosingPlayers || gameIndex > 0) && <button type="button" className="club-button" disabled={busy} onClick={() => {
          if (contact) go({ kind: 'game', gameId: value.games[value.games.length - 1].game.id })
          else if (choosingPlayers) showPlayerStage(currentGame.game.id, 'first')
          else go({ kind: 'game', gameId: value.games[gameIndex - 1].game.id })
        }}>Back</button>}
        {choosingPlayers ? <>
        <button type="button" className="club-button" disabled={busy} onClick={() => {
          if (!validateGame(gameIndex)) return
          showPlayerStage(currentGame.game.id, 'first')
          advance()
        }}>No</button>
        <button type="button" className="club-button primary" disabled={busy || !additionalPlayerPosition(currentGame)} onClick={() => addPlayer(gameIndex)}>Yes</button>
        </> : <button type="submit" className="club-button primary" disabled={busy || !value.games.length || (contact ? disabled : cannotReview)}>{busy ? 'Checking availability…' : contact ? 'Review registration' : playerStage === 'first' ? 'Next' : gameIndex < value.games.length - 1 ? 'Next game' : 'Continue to contact'}</button>}
      </div>
    </footer>
  </form>
}
