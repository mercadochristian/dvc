import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { authRequest, config, guard, logFailure, seal, setCookie, unseal } from '@/lib/club/server'
import { assertSameOrigin, ClubError, requestUrl } from '@/lib/club/validation'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const url = requestUrl(request), reference = randomUUID()
  try {
    const { url: supabase } = config()
    if (url.searchParams.get('start') === 'google') {
      await guard(request, 'auth', 20)
      const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('hex')
      await setCookie('dvc-oauth', seal({ verifier, state, expires: Date.now() + 600000 }), 600)
      const target = new URL(`${supabase}/auth/v1/authorize`)
      target.searchParams.set('provider', 'google')
      target.searchParams.set('redirect_to', `${url.origin}/api/club/auth?state=${state}`)
      target.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
      target.searchParams.set('code_challenge_method', 's256')
      return NextResponse.redirect(target, { headers: { 'Cache-Control': 'no-store' } })
    }
    const raw = (await cookies()).get('dvc-oauth')?.value
    const flow = raw ? unseal<{ verifier: string; state: string; expires: number }>(raw) : null
    const state = url.searchParams.get('state') || ''
    if (!flow || flow.expires < Date.now() || flow.state.length !== state.length || !timingSafeEqual(Buffer.from(flow.state), Buffer.from(state)) || !url.searchParams.get('code')) throw new ClubError('Sign-in expired. Try again', 401, 'OAUTH_STATE')
    await setCookie('dvc-oauth', '', 0)
    const pair = await authRequest<{ access_token: string; refresh_token: string }>('token?grant_type=pkce', { method: 'POST', body: JSON.stringify({ auth_code: url.searchParams.get('code'), code_verifier: flow.verifier }) })
    await setCookie('dvc-auth', seal({ access_token: pair.access_token, refresh_token: pair.refresh_token }))
    return NextResponse.redirect(new URL('/club', url), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    await logFailure(reference, 'auth.google', error instanceof ClubError ? error.code : 'AUTH_ERROR', null)
    return NextResponse.redirect(new URL(`/club?authError=${reference}`, url), { headers: { 'Cache-Control': 'no-store' } })
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const raw = (await cookies()).get('dvc-auth')?.value
    const pair = raw ? unseal<{ access_token: string }>(raw) : null
    if (pair?.access_token) await authRequest('logout', { method: 'POST' }, pair.access_token).catch(() => undefined)
    await setCookie('dvc-auth', '', 0)
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Could not sign out' }, { status: 403 }) }
}
