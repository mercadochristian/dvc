import { googleMapsUrl } from '@/features/club/model/maps'
export function VenueLink({ name, mapsUrl, label }: { name: string; mapsUrl?: string | null; label?: string }) {
  const href = googleMapsUrl(mapsUrl)
  if (!href) return label ? null : <>{name}</>
  return <a className="club-venue-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label || name} — Google Maps (opens in a new tab)`}>{label || name}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4 10 14M10 4H4v16h16v-6" /></svg></a>
}
