import { describe, expect, it } from 'vitest'
import { createBookingLinkToken, verifyBookingLinkToken } from '@/features/club/server/booking-link-token'

const message = 'e44b3823-380c-40b9-a8fd-25490b225c80'
const secret = 'test-signing-secret-at-least-thirty-two-characters'
const organization = 'qa-organization'
const now = Date.parse('2026-11-05T12:00:00Z')
const token = createBookingLinkToken(message, organization, secret, now)

describe('guest booking email link', () => {
  it('authenticates the specific message for seven days', () => {
    const expires = now + 7 * 86_400_000
    expect(verifyBookingLinkToken(token, organization, secret, expires - 1000)).toEqual({ message, expires: expires / 1000 })
    expect(verifyBookingLinkToken(token, organization, secret, expires)).toBeNull()
  })

  it('rejects tampering and cross-organization reuse', () => {
    expect(verifyBookingLinkToken(token.replace(/^e/, 'f'), organization, secret, now)).toBeNull()
    expect(verifyBookingLinkToken(token, 'other-organization', secret, now)).toBeNull()
  })
})
