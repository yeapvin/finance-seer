import { NextRequest, NextResponse } from 'next/server'
import { getLiveQuote } from '@/lib/market-data'

export const dynamic = 'force-dynamic'

export async function GET(_: NextRequest, { params }: { params: { ticker: string } }) {
  try {
    const ticker = (params.ticker as string).toUpperCase()
    const data = await getLiveQuote(ticker)
    if (!data) return NextResponse.json({ error: 'Stock not found' }, { status: 404 })
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch stock data' }, { status: 500 })
  }
}
