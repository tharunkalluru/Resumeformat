import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Resume Formatter | Transform Your Resume',
  description: 'Paste your resume text, edit it like a document, and download a perfectly formatted PDF.',
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
