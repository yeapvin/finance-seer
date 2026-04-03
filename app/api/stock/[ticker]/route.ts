import { NextRequest, NextResponse } from 'next/server'
import { getFinnhubStockData } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { ticker: string } }) {
  try {
    const ticker = (params.ticker as string).toUpperCase()

    const data = await getFinnhubStockData(ticker)
    if (!data) {
      return NextResponse.json({ error: 'Failed to fetch stock data' }, { status: 500 })
    }

    // Map to full StockData shape the UI expects
    return NextResponse.json({
      ticker: data.ticker,
      name: data.name,
      price: data.price,
      change: data.change,
      changePercent: data.changePercent,
      volume: data.volume ?? 0,
      marketCap: data.marketCap,
      peRatio: data.peRatio ?? 0,
      dividendYield: data.dividendYield ?? 0,
      dayHigh: data.dayHigh,
      dayLow: data.dayLow,
      open: data.open,
      previousClose: data.previousClose,
      week52High: data.week52High ?? 0,
      week52Low: data.week52Low ?? 0,
      currency: data.currency,
      exchange: data.exchange,
    })
  } catch (error) {
    console.error(`Error fetching stock ${params.ticker}:`, error)
    return NextResponse.json({ error: 'Failed to fetch stock data' }, { status: 500 })
  }
}
