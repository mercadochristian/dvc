import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { authRequest, setCookie, unseal } from '@/features/club/server/gateway'
import { assertSameOrigin, requestUrl } from '@/features/club/server/http'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const url = requestUrl(request)
  const signIn = new URL('/club/sign-in', url)
  if (url.searchParams.get('booking') === '1') signIn.searchParams.set('booking', '1')
  return NextResponse.redirect(signIn, { headers: { 'Cache-Control': 'no-store' } })
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
