import 'server-only'

import { ClubError } from '../model/validation'
export function requestUrl(request: Request): URL {
  const expected = new URL(request.url)
  // Next's internal request URL can use localhost while Host is 127.0.0.1.
  // Host is the browser's actual destination; never trust forwarded-host here.
  if (request.headers.get('host')) expected.host = request.headers.get('host')!
  return expected
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin'), expected = requestUrl(request)
  if (!origin || origin !== expected.origin) throw new ClubError('Refresh the page and try again', 403, 'ORIGIN_DENIED')
}
export async function limitedBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.body) throw new ClubError('Request body is required')
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new ClubError('Request is too large', 413, 'BODY_TOO_LARGE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
export function imageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (bytes.length > 3 * 1024 * 1024 || bytes.length < 12) throw new ClubError('Use an image up to 3 MB')
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'image/webp'
  throw new ClubError('Use a PNG, JPEG, or WebP image')
}
