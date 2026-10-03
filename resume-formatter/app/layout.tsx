import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ResumeForge | Professional Resume Formatter',
  description: 'Transform your plain text resume into a beautifully formatted, ATS-friendly PDF in seconds.',
  keywords: ['resume', 'formatter', 'PDF', 'job application', 'CV'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
