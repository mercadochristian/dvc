import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ClubError, normalizeEmail, record, text, validatePlayerProfile } from '@/features/club/model/validation'
import { ORG, authRequest, db, guard, identity, logFailure, rpc, setAuthSession } from '@/features/club/server/gateway'
import { assertSameOrigin, limitedBody } from '@/features/club/server/http'

type TokenPair = { access_token: string; refresh_token: string }
const headers = { 'Cache-Control': 'no-store' }

function newPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || new TextEncoder().encode(value).length > 72) {
    throw new ClubError('Use at least 12 characters and no more than 72 bytes for your password')
  }
  return value
}

function code(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6,8}$/.test(value)) throw new ClubError('Enter the verification code from your email')
  return value
}

function post(body: object): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) }
}

async function verifiedAccount(pair: TokenPair) {
  const user = await authRequest<{ id: string; email_confirmed_at?: string }>('user', {}, pair.access_token)
  if (!user.email_confirmed_at) throw new ClubError('Verify your email first', 401)
  return user
}

async function requestEmail(action: 'recover' | 'resend', body: object) {
  try {
    await authRequest(action, post(body))
  } catch (error) {
    if (!(error instanceof ClubError)) throw error
    await logFailure(randomUUID(), `auth.email.${action}`, error.code, null)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const body = record(JSON.parse(new TextDecoder().decode(await limitedBody(request, 4096))))
    await guard(request, 'auth', 20, 'email')

    if (body.action === 'profile') {
      const { user } = await identity()
      if (!user?.email || !user.email_confirmed_at) throw new ClubError('Verify your email first', 401)
      const { level, gender, birth_date, first_timer } = validatePlayerProfile(body)
      await rpc('dvc_create_player_profile', {
        p_org: ORG, p_user: user.id,
        p_data: { name: text(body.name, 'name', 1, 100), contact: user.email, level, gender, birth_date, first_timer },
      })
      return NextResponse.json({ next: 'done' }, { headers })
    }

    const email = normalizeEmail(body.email)
    const settings = await authRequest<{ mailer_autoconfirm?: boolean }>('settings')
    if (settings.mailer_autoconfirm !== false) throw new ClubError('Email verification is not configured yet', 503)
    if (body.action === 'sign-in') {
      if (typeof body.password !== 'string' || !body.password || body.password.length > 256) throw new ClubError('Enter your password')
      const pair = await authRequest<TokenPair>('token?grant_type=password', post({ email, password: body.password }))
      const user = await verifiedAccount(pair)
      const profile = await db<{ user_id: string }[]>(`player_profiles?select=user_id&organization_id=eq.${encodeURIComponent(ORG)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`)
      await setAuthSession(pair, body.remember === true)
      return NextResponse.json({ next: profile.length ? 'done' : 'profile' }, { headers })
    }

    if (body.action === 'sign-up' || body.action === 'resend') {
      if (body.action === 'sign-up') {
        await authRequest('signup', post({ email, password: newPassword(body.password) }))
      } else {
        await requestEmail('resend', { email, type: 'signup' })
      }
      return NextResponse.json({ next: 'verify' }, { headers })
    }

    if (body.action === 'verify') {
      const pair = await authRequest<TokenPair>('verify', post({ email, token: code(body.code), type: 'signup' }))
      await verifiedAccount(pair)
      await setAuthSession(pair, false)
      return NextResponse.json({ next: 'profile' }, { headers })
    }

    if (body.action === 'forgot') {
      await requestEmail('recover', { email })
      return NextResponse.json({ next: 'reset' }, { headers })
    }

    if (body.action === 'reset') {
      const password = newPassword(body.password)
      const pair = await authRequest<TokenPair>('verify', post({ email, token: code(body.code), type: 'recovery' }))
      await verifiedAccount(pair)
      try {
        await authRequest('user', { ...post({ password }), method: 'PUT' }, pair.access_token)
      } catch (error) {
        if (!(error instanceof ClubError)) throw error
        throw new ClubError('We could not confirm the password change. Try signing in with the new password, or request another code.', error.status === 503 ? 503 : 409)
      }
      return NextResponse.json({ next: 'sign-in' }, { headers })
    }

    throw new ClubError('Invalid request')
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers })
    const status = error instanceof ClubError ? error.status : 500
    const message = status === 401 ? 'Check your email, password, or verification code and try again.'
      : error instanceof ClubError ? error.message : 'Could not complete that request. Try again.'
    return NextResponse.json({ error: message }, { status, headers })
  }
}
