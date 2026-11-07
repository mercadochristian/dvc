'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { GENDER_LABEL, LEVEL_LABEL } from '@/features/club/model/types'

import { ErrorNotice } from '@/features/club/ui/shared/primitives'
import { RequiredLabel, RequiredMark, RequiredNote } from '@/features/club/ui/shared/required'

type Step = 'sign-in' | 'sign-up' | 'verify' | 'profile' | 'forgot' | 'reset'
const titles: Record<Step, string> = {
  'sign-in': 'Sign in to DVC',
  'sign-up': 'Create your account',
  verify: 'Verify your email',
  profile: 'Set up your player profile',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
}

export default function SignInPage() {
  const [step, setStep] = useState<Step>('sign-in')
  const [email, setEmail] = useState('')
  const [booking, setBooking] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setBooking(params.get('booking') === '1')
    setReady(true)
  }, [])

  function goTo(next: Step) {
    setStep(next)
    setError('')
    setNotice('')
    heading.current?.focus()
  }

  async function submit(action: Step | 'resend', fields: Record<string, unknown> = {}) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/club/auth/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email, ...fields }),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(result.error || 'Something went wrong. Try again.')
        return
      }
      if (result.next === 'done') {
        window.location.assign(booking ? '/club/booking-link' : '/club')
      } else if (action === 'resend') {
        setNotice('If a code can be sent to this address, check your inbox for the latest email.')
      } else {
        goTo(result.next)
        if (action === 'reset') setNotice('Password updated. Sign in with your new password.')
      }
    } catch {
      setError('Could not connect. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const fields = Object.fromEntries(data)
    void submit(step, {
      ...fields,
      ...(step === 'sign-in' ? { remember: data.has('remember') } : {}),
      ...(step === 'profile' ? { first_timer: data.get('first_timer') === 'yes' } : {}),
    })
  }

  return <main className="club-app club-booking-link-page club-auth-page">
    <section className="club-panel club-booking-link-panel" aria-labelledby="club-auth-title">
      <a className="club-auth-back" href={booking ? '/club/booking-link' : '/club'}>Back to {booking ? 'your booking' : 'Games'}</a>
      <h1 id="club-auth-title" ref={heading} tabIndex={-1}>{titles[step]}</h1>
      {(step === 'verify' || step === 'reset') && <p>Enter the code from your email at <strong>{email}</strong>.</p>}
      {step === 'profile' && <p>We’ll use these details to fill out your game registration.</p>}
      <form key={step} method="post" className="club-form" onSubmit={handleSubmit}>
        <fieldset className="club-form club-auth-fields" disabled={!ready || busy}>
          <RequiredNote />
          {(step === 'sign-in' || step === 'sign-up' || step === 'forgot') && <>
            <label><span>Email<RequiredMark /></span><input name="email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} maxLength={254} /></label>
            {step !== 'forgot' && <div className="club-auth-field"><label><span>Password<RequiredMark /></span><input name="password" type="password" aria-describedby={step === 'sign-up' ? 'club-password-help' : undefined} autoComplete={step === 'sign-in' ? 'current-password' : 'new-password'} required minLength={step === 'sign-up' ? 12 : undefined} maxLength={256} /></label>
              {step === 'sign-up' && <small className="club-note" id="club-password-help">Use at least 12 characters.</small>}
            </div>}
            {step === 'sign-in' && <label className="club-check"><input name="remember" type="checkbox" /> Remember me</label>}
          </>}
          {(step === 'verify' || step === 'reset') && <label><span>Verification code<RequiredMark /></span><input name="code" aria-describedby={error ? 'club-auth-error' : undefined} aria-invalid={Boolean(error)} inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6,8}" maxLength={8} /></label>}
          {step === 'reset' && <div className="club-auth-field">
            <label><span>New password<RequiredMark /></span><input name="password" type="password" autoComplete="new-password"
              aria-describedby="club-password-help" minLength={12} required /></label>
            <small className="club-note" id="club-password-help">Use at least 12 characters.</small>
          </div>}
          {step === 'profile' && <>
            <label><span>Full name<RequiredMark /></span><input name="name" autoComplete="name" required maxLength={100} /></label>
            <label><span>Birthday<RequiredMark /></span><input name="birth_date" type="date" autoComplete="bday" required /></label>
            {([{ name: 'gender', label: 'Gender', choices: GENDER_LABEL },
              { name: 'level', label: 'Skill level', choices: LEVEL_LABEL },
              { name: 'first_timer', label: 'Have you played with DVC before?', choices: { no: 'Yes, I’m a returnee', yes: 'No, I’m a first-timer' } }]).map(({ name, label, choices }) =>
              <div className="club-auth-select" key={name}><label htmlFor={`auth-${name}`}><RequiredLabel>{label}</RequiredLabel></label><select id={`auth-${name}`} name={name} defaultValue="" required>
                <option value="" disabled>Choose an option</option>
                {Object.entries(choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></div>
            )}
          </>}
          <ErrorNotice id="club-auth-error" message={error} />
          {notice && <p role="status">{notice}</p>}
          <button className="club-button primary" type="submit">{busy ? 'Please wait…' : {
            'sign-in': 'Sign in', 'sign-up': 'Send verification code', verify: 'Verify email', profile: 'Save profile', forgot: 'Send reset code', reset: 'Update password',
          }[step]}</button>
        </fieldset>
      </form>
      {step !== 'profile' && <div className="club-auth-actions">
        {step === 'verify' && <>
          <button type="button" className="club-button quiet" disabled={busy} onClick={() => goTo('sign-up')}>Edit email</button>
          <button type="button" className="club-button quiet" disabled={busy} onClick={() => void submit('resend')}>Resend code</button>
        </>}
        {step === 'sign-in' && <>
          <button type="button" className="club-button quiet" disabled={busy} onClick={() => goTo('forgot')}>Forgot password?</button>
          <button type="button" className="club-button quiet" disabled={busy} onClick={() => goTo('sign-up')}>Create account</button>
        </>}
        {step === 'reset' && <button type="button" className="club-button quiet" disabled={busy} onClick={() => goTo('forgot')}>Request another code</button>}
        {(step === 'sign-up' || step === 'forgot' || step === 'reset') && <button type="button" className="club-button quiet" disabled={busy} onClick={() => goTo('sign-in')}>Back to sign in</button>}
      </div>}
    </section>
  </main>
}
