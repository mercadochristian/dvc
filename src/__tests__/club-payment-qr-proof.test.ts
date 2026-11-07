import { afterEach, describe, expect, it, vi } from 'vitest'
import { issuePaymentQrProof, verifyPaymentQrProof } from '@/features/club/server/payment-qr-proof'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('M6 payment QR upload proof', () => {
  it('authorizes only the same actor, method, path and unexpired upload', () => {
    vi.stubEnv('DVC_SESSION_SECRET', 'local-unit-fixture-secret-for-qr-proof')
    vi.useFakeTimers()
    const proof = issuePaymentQrProof('staff-a', 'method-a', 'qr/a.png')
    expect(verifyPaymentQrProof(proof, 'staff-a', 'method-a', 'qr/a.png')).toBe('qr/a.png')
    expect(verifyPaymentQrProof(proof, 'staff-b', 'method-a', 'qr/a.png')).toBeNull()
    expect(verifyPaymentQrProof(proof, 'staff-a', 'method-b', 'qr/a.png')).toBeNull()
    expect(verifyPaymentQrProof(proof, 'staff-a', 'method-a', 'qr/b.png')).toBeNull()
    expect(verifyPaymentQrProof(`b${proof.slice(1)}-altered`, 'staff-a', 'method-a', 'qr/a.png')).toBeNull()
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(verifyPaymentQrProof(proof, 'staff-a', 'method-a', 'qr/a.png')).toBeNull()
  })
})
