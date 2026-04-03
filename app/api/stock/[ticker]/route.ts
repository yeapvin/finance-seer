import { NextRequest, NextResponse } from 'next/server'
import { getStockData } from '@/lib/yahoo'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { ticker: string } }) {
  try {
    const ticker = (params.ticker as string).toUpperCase()

    const data = await getStockData(ticker)

    return NextResponse.json(data)
  } catch (error) {
    console.error(`Error fetching stock ${params.ticker}:`, error)
    return NextResponse.json(
      { error: 'Failed to fetch stock data' },
      { status: 500 },
    )
  }
}
