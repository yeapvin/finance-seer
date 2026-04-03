import { NextRequest, NextResponse } from 'next/server'
import { searchStocks } from '@/lib/yahoo'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q')

    if (!query || query.length < 1) {
      return NextResponse.json({ results: [] })
    }

    let results: any[] = []
    try {
      results = await searchStocks(query)
    } catch (err) {
      console.error('[search] searchStocks error:', err)
      results = []
    }

    // Filter out options, futures, and other non-equity/ETF types
    const filtered = results.filter((r: any) =>
      r.type === 'equity' || r.type === 'etf'
    )

    const response = NextResponse.json({ results: filtered })
    
    // Cache successful responses at the edge for 1 hour
    if (filtered.length > 0) {
      response.headers.set('Cache-Control', 'public, max-age=3600')
    }

    return response
  } catch (error) {
    console.error('[search] Route error:', error)
    return NextResponse.json(
      { error: 'Failed to search stocks', details: String(error) },
      { status: 500 },
    )
  }
}
