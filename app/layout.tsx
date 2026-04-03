import './globals.css'

export const metadata = {
  title: 'Finance Oracle - AI-Powered Stock Analysis',
  description: 'Real-time charts, technical indicators, pattern recognition, and AI-driven investment analysis — free and open.',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
  themeColor: '#000000',
  icons: { icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🔮</text></svg>' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <body className='bg-black antialiased'>
        <main className='min-h-screen'>{children}</main>
      </body>
    </html>
  )
}
