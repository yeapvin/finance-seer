import { NextRequest, NextResponse } from 'next/server'
import { getFinnhubStockData } from '@/lib/finnhub'
import { getStockData } from '@/lib/yahoo'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { ticker: string } }) {
  try {
    const ticker = (params.ticker as string).toUpperCase()

    // Try Finnhub first (primary)
    let data = await getFinnhubStockData(ticker)
    
    // Fallback to Yahoo if Finnhub doesn't have it
    if (!data) {
      console.warn(`Finnhub unavailable for ${ticker}, falling back to Yahoo`)
      data = await getStockData(ticker)
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error(`Error fetching stock ${params.ticker}:`, error)
    return NextResponse.json(
      { error: 'Failed to fetch stock data' },
      { status: 500 },
    )
  }
}
