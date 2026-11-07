import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { guard, identity, ORG, rpc, setCookie } from '@/features/club/server/gateway'
import { assertSameOrigin, limitedBody } from '@/features/club/server/http'
import { verifyBookingLinkToken } from '@/features/club/server/booking-link-token'
import { ClubError, record } from '@/features/club/model/validation'

function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    await guard(request, 'auth')
    const body = record(JSON.parse(new TextDecoder().decode(await limitedBody(request, 1024))))
    const token = body.token ?? (await cookies()).get('dvc-booking-link')?.value
    const verified = verifyBookingLinkToken(token, ORG, process.env.DVC_SESSION_SECRET ?? '')
    if (!verified) return response({ outcome: 'unavailable' }, 404)
    const { user } = await identity()
    const result = await rpc<{ outcome: string } | null>('dvc_open_guest_checkout', {
      p_org: ORG, p_message: verified.message, p_user: user?.id ?? null,
    })
    if (!result) return response({ outcome: 'unavailable' }, 404)
    await setCookie('dvc-booking-link', result.outcome === 'linked' ? '' : String(token),
      result.outcome === 'linked' ? 0 : Math.max(0, verified.expires - Math.floor(Date.now() / 1000)))
    return response(result)
  } catch (error) {
    return response({ outcome: 'error' }, error instanceof ClubError ? error.status : 500)
  }
}
