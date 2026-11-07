'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { act, ensureGuestSession, read, upload } from '@/features/club/api/client'
import { checkoutDraftFrom, initialCheckoutForm, quotedCheckoutDraft, type CheckoutForm } from '@/features/club/model/checkout-form'
import { shouldConfirmDraftDiscard } from '@/features/club/model/checkout-fields'
import type { CheckoutStep } from '@/features/club/model/checkout-wizard'
import styles from './checkout-wizard.module.css'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import type { Checkout, CheckoutDraft, CheckoutQuote, ClubGame, ClubSession, PaymentMethod, RegistrationProfile } from '@/features/club/model/types'
import { Empty, ErrorNotice, Modal } from '../shared/primitives'
import { CheckoutDetails } from './checkout-details'
import { CheckoutPayment, checkoutPaymentDisplay } from './checkout-payment'
import { focusCheckoutStage } from './checkout-focus'
import { CheckoutReview } from './checkout-review'
import { checkoutFromResponse, checkoutHoldFailure, checkoutMutation, CheckoutReviewRequest, type ReviewedCheckout } from './checkout-request'

export interface PendingCheckoutIntent { payload: CheckoutDraft; form: CheckoutForm }
interface Props {
  games?: ClubGame[]; checkoutId?: string; recovery?: PendingCheckoutIntent; session: ClubSession
  close: () => void; done: (checkout: Checkout) => void; pending: (intent: PendingCheckoutIntent | null) => void; resolved: (checkout: Checkout) => void
}

export function CheckoutRegistration(props: Props) {
  const identity = props.session.user?.id || 'guest'
  const intent = props.checkoutId || props.recovery?.payload.request_id || props.games?.map(game => game.id).join(',') || 'empty'
  return <CheckoutRegistrationBody key={`${identity}:${intent}`} {...props} />
}

function registrationForm(games: ClubGame[], session: ClubSession, profile?: RegistrationProfile | null) {
  const form = initialCheckoutForm(games, session, profile)
  for (const game of form.games) game.players[0].has_details = true
  return form
}

function CheckoutRegistrationBody({ games = [], checkoutId, recovery, session, close, done, pending, resolved }: Props) {
  const [form, setForm] = useState<CheckoutForm | null>(() => recovery?.form || (!session.user && games.length ? registrationForm(games, session) : null))
  const [discarding, setDiscarding] = useState(false)
  const dirty = useRef(false), discardFocus = useRef<HTMLElement | null>(null), editingFocus = useRef<HTMLElement | null>(null), keepEditing = useRef<HTMLButtonElement>(null)
  const discardScrollTop = useRef(0)
  const [step, setStep] = useState<CheckoutStep>(() => games[0] ? { kind: 'game', gameId: games[0].id } : { kind: 'contact' })
  const lastPlayerGame = useRef(games[0]?.id)
  const [contactReached, setContactReached] = useState(false)
  function navigate(next: CheckoutStep) {
    if (next.kind === 'game') lastPlayerGame.current = next.gameId
    else setContactReached(true)
    setStep(next)
  }
  const [activePlayer, setActivePlayer] = useState<Record<string, string>>({})
  const refreshSkill = useRef(false)
  const [profile, setProfile] = useState<RegistrationProfile | null>(null), [profileFailed, setProfileFailed] = useState(false), [profileVersion, setProfileVersion] = useState(0)
  const [reviewRequest] = useState(() => new CheckoutReviewRequest())
  const [reviewed, setReviewed] = useState<ReviewedCheckout | null>(null), [reviewing, setReviewing] = useState(false)
  const [intent, setIntent] = useState<PendingCheckoutIntent | null>(recovery || null), [checkout, setCheckout] = useState<Checkout | null>(null)
  const [methods, setMethods] = useState<PaymentMethod[]>([]), [method, setMethod] = useState(''), [methodsLoaded, setMethodsLoaded] = useState(false), [methodsFailed, setMethodsFailed] = useState(false), [methodsVersion, setMethodsVersion] = useState(0)
  const [error, setError] = useState<unknown>(null), [information, setInformation] = useState(''), [issues, setIssues] = useState<Record<string, string>>({})
  const [mutating, setMutating] = useState(false), [checking, setChecking] = useState(false), [uncertainReceipt, setUncertainReceipt] = useState(false)
  const [loadingCheckout, setLoadingCheckout] = useState(Boolean(checkoutId)), [checkoutVersion, setCheckoutVersion] = useState(0), [now, setNow] = useState(() => Date.now())
  const mounted = useRef(false), mutationInFlight = useRef(false), checkInFlight = useRef(false), stageFocus = useRef<HTMLDivElement>(null)
  const stage = checkout ? 'payment' : intent ? 'recovery' : loadingCheckout || !form ? 'loading' : reviewed ? 'review' : 'details'

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; reviewRequest.invalidate() } }, [reviewRequest])
  useEffect(() => {
    let active = true
    setMethodsLoaded(false); setMethodsFailed(false)
    read<PaymentMethod[]>('methods').then(value => {
      if (!active) return
      setMethods(value); setMethod(current => value.some(entry => entry.id === current) ? current : value[0]?.id || '')
    }).catch(() => { if (active) setMethodsFailed(true) }).finally(() => { if (active) setMethodsLoaded(true) })
    return () => { active = false }
  }, [methodsVersion])
  useEffect(() => {
    if (checkoutId || !session.user) return
    let active = true
    setProfileFailed(false)
    const replaceLevel = refreshSkill.current
    read<RegistrationProfile | null>('profile').then(value => {
      if (!active || refreshSkill.current !== replaceLevel) return
      if (replaceLevel && !value?.level) { setProfileFailed(true); return }
      refreshSkill.current = false
      setProfile(value)
      setForm(current => !current ? registrationForm(games, session, value) : replaceLevel ? {
        ...current,
        games: current.games.map(game => ({
          ...game, players: game.players.map(player => player.is_registrant ? { ...player, level: value?.level ?? null } : player),
        })),
      } : current)
    }).catch(() => {
      if (active && refreshSkill.current === replaceLevel) setProfileFailed(true)
    })
    return () => { active = false }
  // This body remounts on identity/intent changes. A profile or session refresh
  // must never reset an already editable registration.
  }, [session.user?.id, checkoutId, profileVersion])
  useEffect(() => {
    if (!checkoutId) return
    let active = true; setLoadingCheckout(true); setError(null)
    checkoutMutation(() => read<Checkout>('checkout', { id: checkoutId })).then(value => {
      if (active) {
        const result = checkoutFromResponse(value)
        if (result.id !== checkoutId) throw new Error('The returned reservation does not match this checkout. Retry loading it.')
        setCheckout(result); resolved(result)
      }
    }).catch(error => { if (active) setError(error) }).finally(() => { if (active) setLoadingCheckout(false) })
    return () => { active = false }
  }, [checkoutId, checkoutVersion])
  useEffect(() => { if (!checkout) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [checkout?.id])
  useEffect(() => { if (stage !== 'loading' && !stageFocus.current?.closest('[hidden]')) focusCheckoutStage(stageFocus.current) }, [stage])

  function edit(value: CheckoutForm) {
    dirty.current = true
    reviewRequest.invalidate(); setReviewing(false); setReviewed(null); setForm(value); setError(null); setIssues({})
  }
  function resumeEditing() {
    setDiscarding(false)
    requestAnimationFrame(() => {
      const target = discardFocus.current
      if (!target?.isConnected) { focusCheckoutStage(stageFocus.current); return }
      const body = target.closest<HTMLElement>('.club-dialog-body')
      if (body) body.scrollTop = discardScrollTop.current
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    })
  }
  function dismiss() {
    if (mutationInFlight.current) return
    if (discarding) { resumeEditing(); return }
    if (shouldConfirmDraftDiscard(dirty.current, stage)) {
      discardFocus.current = document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-registration-content]') ? document.activeElement : editingFocus.current
      discardScrollTop.current = stageFocus.current?.closest<HTMLElement>('.club-dialog-body')?.scrollTop ?? 0
      setDiscarding(true)
      requestAnimationFrame(() => keepEditing.current?.focus())
      return
    }
    reviewRequest.invalidate(); close()
  }
  async function review() {
    if (!form || refreshSkill.current || reviewing || mutationInFlight.current || intent) return
    setError(null); setIssues({}); setReviewing(true)
    try {
      const draft = checkoutDraftFrom(form, crypto.randomUUID())
      await reviewRequest.load(draft, data => act<{ checkout: CheckoutQuote }>('checkout.review', data), result => { setReviewed(result); setReviewing(false) }, error => { setError(error); setReviewing(false) }, session.user ? undefined : ensureGuestSession)
    } catch (error) { if (mounted.current) { setError(error); setReviewing(false) } }
  }
  function acceptCheckout(value: unknown, resolveIntent: boolean) {
    const result = checkoutFromResponse(value)
    setCheckout(result); setNow(Date.now()); setUncertainReceipt(false)
    if (resolveIntent) setIntent(null)
    resolved(result)
    return result
  }
  async function hold(existing?: PendingCheckoutIntent) {
    if (mutationInFlight.current) return
    let attempt: PendingCheckoutIntent
    try {
      if (existing) attempt = existing
      else {
        if (!form || !reviewed) return
        const current = checkoutDraftFrom(form, reviewed.draft.request_id)
        attempt = { payload: quotedCheckoutDraft(current, reviewed), form: structuredClone(form) }
      }
    } catch (error) { setError(error); setReviewed(null); return }
    mutationInFlight.current = true; setMutating(true); setError(null); setInformation(''); setIntent(attempt); pending(attempt)
    try {
      const result = await checkoutMutation(signal => act<{ checkout: Checkout }>('checkout.hold', attempt.payload, signal))
      if (mounted.current) acceptCheckout(result.checkout, true)
    } catch (error) {
      if (!mounted.current) return
      const outcome = checkoutHoldFailure(error)
      if (outcome.kind === 'existing') {
        acceptCheckout(outcome.checkout, true); setInformation('This request already belongs to an existing checkout. Its original reservation details are shown below.'); return
      }
      if (outcome.kind === 'selection-conflict') {
        setIntent(null); pending(null); setReviewed(null); setForm(attempt.form)
        setIssues(outcome.issues)
        if (outcome.skillChanged) {
          refreshSkill.current = true
          setProfileVersion(value => value + 1)
        }
        const affected = attempt.form.games.find(entry => outcome.issues[entry.game.id])
        if (affected) setStep({ kind: 'game', gameId: affected.game.id })
      }
      setError(error)
    } finally {
      mutationInFlight.current = false
      if (mounted.current) setMutating(false)
    }
  }
  async function checkReceiptStatus() {
    if (!checkout || checkInFlight.current || mutationInFlight.current) return
    checkInFlight.current = true; setChecking(true); setError(null)
    try {
      const value = await checkoutMutation(() => read<Checkout>('checkout', { id: checkout.id }))
      if (mounted.current) {
        if (value.id !== checkout.id) throw new Error('The returned reservation does not match this checkout. Check its status again.')
        acceptCheckout(value, false)
      }
    } catch (error) { if (mounted.current) setError(error) }
    finally { checkInFlight.current = false; if (mounted.current) setChecking(false) }
  }
  async function receipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!checkout || mutationInFlight.current || uncertainReceipt) return
    const data = new FormData(event.currentTarget); data.set('kind', 'checkout_receipt'); data.set('checkout', checkout.id); data.set('method', method)
    mutationInFlight.current = true; setMutating(true); setError(null)
    try {
      const value = await checkoutMutation(signal => upload<{ checkout: Checkout }>(data, signal))
      if (!mounted.current) return
      const result = checkoutFromResponse(value.checkout)
      if (result.id !== checkout.id || result.status !== 'reserved' || result.payment_status !== 'approved') throw new Error('Check the reservation status to confirm the upload result.')
      setCheckout(result); done(result)
    } catch (error) {
      if (!mounted.current) return
      setUncertainReceipt(true); setError(error)
      // The write transport has settled or timed out. Status checking is a
      // separate read and must not trap the user in a non-dismissible modal.
      mutationInFlight.current = false; setMutating(false); checkInFlight.current = true; setChecking(true)
      try {
        const value = await checkoutMutation(() => read<Checkout>('checkout', { id: checkout.id }))
        if (!mounted.current) return
        if (value.id !== checkout.id) throw new Error('Check the original checkout status again.')
        const result = acceptCheckout(value, false)
        if (result.status === 'reserved' && result.payment_status === 'approved') done(result)
      } catch { /* The same checkout remains recoverable; do not claim a lost booking. */ }
    } finally { mutationInFlight.current = false; checkInFlight.current = false; if (mounted.current) { setMutating(false); setChecking(false) } }
  }

  const paymentMethodsStatus = !methodsLoaded ? <p className="club-note" role="status">Loading payment methods…</p>
    : (methodsFailed || !methods.length) && <div className="club-form">
      <p className="club-note">{methodsFailed ? 'Payment methods could not be loaded.' : checkout
        ? 'No payment method is available. Contact the club before your hold expires.'
        : 'Registration opens once the club adds a payment method.'}</p>
      <div className="club-actions"><button type="button" className="club-button" disabled={mutating}
        onClick={() => setMethodsVersion(value => value + 1)}>Retry payment methods</button></div>
    </div>

  return <Modal className={styles.dialog} title={discarding ? 'Discard registration?' : checkout ? checkoutPaymentDisplay(checkout, now).title : stage === 'review' ? 'Review registration' : stage === 'recovery' ? 'Check reservation' : 'Register'} close={dismiss} wide={Boolean(form && form.games.length > 1)} dismissible={!mutating}>
    {discarding && <section className="club-form" aria-label="Discard registration confirmation"><p>Your entered player and contact details will be discarded. Your selected games will stay selected. No slots have been held.</p><div className="club-actions"><button type="button" className="club-button primary" ref={keepEditing} onClick={resumeEditing}>Keep editing</button><button type="button" className="club-button" onClick={() => { reviewRequest.invalidate(); close() }}>Discard registration</button></div></section>}
    <div hidden={discarding} data-registration-content onFocusCapture={event => { if (event.target instanceof HTMLElement) editingFocus.current = event.target }}>
    <ErrorNotice error={error} />{information && <p className="club-note" role="status">{information}</p>}
    <div ref={stageFocus} tabIndex={-1} aria-label={stage === 'payment' ? 'Checkout payment' : stage === 'recovery' ? 'Reservation recovery' : stage === 'review' ? 'Registration review' : 'Registration details'}>
      {stage === 'loading' ? checkoutId && !loadingCheckout && error ? <button type="button" className="club-button" onClick={() => setCheckoutVersion(value => value + 1)}>Retry loading reservation</button> : profileFailed ? <div className="club-form"><p role="status">Saved player details could not be loaded.</p><button type="button" className="club-button" onClick={() => setProfileVersion(value => value + 1)}>Retry player details</button></div> : <Empty>{checkoutId ? 'Loading reservation…' : 'Loading saved player details…'}</Empty> : checkout ? <CheckoutPayment checkout={checkout} methods={methods} method={method} setMethod={setMethod} methodsStatus={paymentMethodsStatus} now={now} busy={mutating} uncertain={uncertainReceipt} checking={checking} submit={event => void receipt(event)} check={() => void checkReceiptStatus()} done={() => done(checkout)} /> : intent ? <div className="club-form">
        <p>{mutating ? 'Checking your reservation…' : 'The reservation result is not confirmed. Check this request before starting another checkout.'}</p>
        {intent.payload.games.map(game => <div key={game.game_id}><strong>{game.expected_quote?.venue || 'Selected game'}</strong>{game.expected_quote && <p className="club-note">{dateLabel(game.expected_quote.starts_at)} · {timeLabel(game.expected_quote.starts_at)}–{timeLabel(game.expected_quote.ends_at)} · {money(game.expected_amount || 0)}</p>}</div>)}
        <button type="button" className="club-button primary" disabled={mutating} onClick={() => void hold(intent)}>{mutating ? 'Checking…' : 'Check reservation'}</button>
        <p className="club-note">Checking reuses the original request and expiry. You can also find any committed reservation in My bookings.</p>
      </div> : reviewed ? <CheckoutReview guest={!session.user} draft={reviewed.draft} quote={reviewed.quote} busy={mutating} edit={() => { reviewRequest.invalidate(); setReviewed(null); setError(null); const game = form?.games.find(entry => entry.game.id === lastPlayerGame.current) ?? form?.games[0]; if (game) navigate({ kind: 'game', gameId: game.game.id }) }} editContact={() => { reviewRequest.invalidate(); setReviewed(null); setError(null); navigate({ kind: 'contact' }) }} confirm={() => void hold()} /> : form ? <>
        {refreshSkill.current && <div className="club-actions">
          <p role="status">{profileFailed ? 'Could not load the updated skill level.' : 'Loading the updated skill level…'}</p>
          {profileFailed && <button type="button" className="club-button" onClick={() => setProfileVersion(value => value + 1)}>Retry player details</button>}
        </div>}
        <CheckoutDetails step={step} navigate={navigate} contactReached={contactReached} activePlayer={activePlayer} activatePlayer={(gameId, playerId) => setActivePlayer(current => ({ ...current, [gameId]: playerId }))} value={form} update={edit} profile={profile} signedIn={Boolean(session.user)} busy={reviewing} disabled={refreshSkill.current || !methodsLoaded || !methods.length} issues={issues} submit={() => void review()} />
      </> : null}
    </div>
    {!checkout && !intent && stage !== 'loading' && paymentMethodsStatus}
    </div>
  </Modal>
}
