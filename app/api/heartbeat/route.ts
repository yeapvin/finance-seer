import { NextRequest, NextResponse } from 'next/server'
import { checkPortfolioExits, calculatePortfolioValue } from '@/lib/portfolio-prices'

// Mock portfolio data (since we can't read files on Vercel)
const PORTFOLIO = {
  cash: 42599.51,
  positions: [
    {
      ticker: 'NVDA',
      shares: 119,
      avgCost: 167.52,
      stopLoss: 160,
      takeProfit: 178,
    },
    {
      ticker: 'AAPL',
      shares: 80,
      avgCost: 248.8,
      stopLoss: 245,
      takeProfit: 258,
    },
    {
      ticker: 'CRM',
      shares: 109,
      avgCost: 183.53,
      stopLoss: 175.72,
      takeProfit: 200.85,
    },
  ],
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Check exits (uses Finnhub for real-time prices, no rate limits!)
    const { results, triggered } = await checkPortfolioExits(PORTFOLIO)

    // Calculate total value
    const totalValue = await calculatePortfolioValue(PORTFOLIO)

    // Check for triggered exits
    const exitAlerts = triggered.map(t => ({
      ticker: t.ticker,
      currentPrice: t.currentPrice,
      reason: t.status === 'EXIT_SL' ? `SL hit: $${t.stopLoss}` : `TP hit: $${t.takeProfit}`,
      pnl: t.pnl,
      pnlPct: t.pnlPct,
    }))

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      portfolio: {
        totalValue: totalValue.toFixed(2),
        cash: PORTFOLIO.cash,
        positions: results,
        exitAlerts,
      },
      status: exitAlerts.length > 0 ? 'ACTION_REQUIRED' : 'OK',
    })
  } catch (error) {
    console.error('Heartbeat error:', error)
    return NextResponse.json(
      { error: 'Heartbeat check failed', details: String(error) },
      { status: 500 },
    )
  }
}

