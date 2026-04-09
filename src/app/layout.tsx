import type { Metadata, Viewport } from 'next'
import './globals.css'
import { InstallPrompt } from '@/components/install-prompt'

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: 'DVC Fun Games',
  description: 'Check available positions for Dreamers Volleyball Club Fun Games this week.',
  applicationName: 'DVC Fun Games',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'DVC Games',
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
      </body>
    </html>
  )
}
