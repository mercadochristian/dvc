import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DVC Court Play',
    short_name: 'Court Play',
    description:
      'Check available positions for Dreamers Volleyball Club Court Play this week.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f1117',
    theme_color: '#0f1117',
    categories: ['sports'],
    icons: [
      { src: '/logo.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/logo.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/logo.png', sizes: 'any', type: 'image/png', purpose: 'any' },
    ],
  }
}
