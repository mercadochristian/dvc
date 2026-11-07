import 'server-only'
import { ORG, seal, unseal } from './gateway'

export function issuePaymentQrProof(actor: string, method: string | null, path: string) {
  return seal({ kind: 'payment-qr', org: ORG, actor, method, path, expires: Date.now() + 60 * 60 * 1000 })
}

export function verifyPaymentQrProof(token: unknown, actor: string | null, method: unknown, path: unknown) {
  if (!actor || typeof token !== 'string' || token.length > 2048 || typeof path !== 'string') return null
  const proof = unseal<{ kind: string; org: string; actor: string; method: string | null; path: string; expires: number }>(token)
  return proof?.kind === 'payment-qr' && proof.org === ORG && proof.actor === actor &&
    proof.method === (method ?? null) && proof.path === path && proof.expires > Date.now() ? path : null
}
