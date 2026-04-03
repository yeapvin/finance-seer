import { NextRequest, NextResponse } from 'next/server'
import { getNews } from '@/lib/market-data'

export const dynamic = 'force-dynamic'

export async function GET(_: NextRequest, { params }: { params: { ticker: string } }) {
  try {
    const ticker = (params.ticker as string).toUpperCase()
    const news = await getNews(ticker)
    const pos = news.filter(n => n.sentiment === 'positive').length
    const neg = news.filter(n => n.sentiment === 'negative').length
    const score = news.length > 0 ? (pos - neg) / news.length : 0
    return NextResponse.json({
      ticker, news,
      sentiment: score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral',
      sentimentScore: parseFloat(score.toFixed(2))
    })
  } catch {
    return NextResponse.json({ ticker: params.ticker, news: [], sentiment: 'neutral', sentimentScore: 0 })
  }
}
