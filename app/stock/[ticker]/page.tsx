'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

// Legacy route — redirect to homepage with the ticker
export default function StockPage() {
  const params = useParams()
  const router = useRouter()
  const ticker = params?.ticker as string

  useEffect(() => {
    // Redirect to homepage — the SPA handles everything
    router.replace('/')
  }, [router])

  return (
    <div className='min-h-screen bg-black flex items-center justify-center'>
      <p className='text-zinc-500'>Redirecting to {ticker}...</p>
    </div>
  )
}
