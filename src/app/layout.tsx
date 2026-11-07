import type { Metadata, Viewport } from 'next'
import './globals.css'
import './club.css'
import { InstallPrompt } from '@/features/pwa/install-prompt'
import { ScrollReveals } from '@/features/motion/scroll-reveals'
import './motion.css'

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: 'DVC Court Play',
  description: 'Check available positions for Dreamers Volleyball Club Court Play this week.',
  applicationName: 'DVC Court Play',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Court Play',
  },
  icons: {
    icon: [
      { url: '/logo.png', sizes: '192x192', type: 'image/png' },
      { url: '/logo.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/logo.png' }],
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#0f1117',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <InstallPrompt />
        <ScrollReveals />
      </body>
    </html>
  )
}
