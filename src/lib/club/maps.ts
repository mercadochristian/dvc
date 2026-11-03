/** Accept Google Maps share/search URLs without allowing arbitrary external links. */
export function googleMapsUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const host = url.hostname.toLowerCase()
    const allowed = host === 'maps.app.goo.gl'
      || (host === 'goo.gl' && url.pathname.startsWith('/maps/'))
      || (['google.com', 'www.google.com', 'google.com.ph', 'www.google.com.ph'].includes(host) && /^\/maps(?:\/|$)/.test(url.pathname))
      || ['maps.google.com', 'maps.google.com.ph'].includes(host)
    return allowed && url.href.length <= 2048 ? url.href : null
  } catch { return null }
}
