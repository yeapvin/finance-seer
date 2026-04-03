import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Read portfolio from static JSON bundled at build time
import portfolioData from '@/data/portfolio.json'

// Company name lookup
const COMPANY_NAMES: Record<string, string> = {
  AAPL: 'Apple Inc.',
  GOOGL: 'Alphabet Inc.',
  AMZN: 'Amazon.com Inc.',
  NVDA: 'NVIDIA Corp.',
  COST: 'Costco Wholesale Corp.',
  MSFT: 'Microsoft Corp.',
  META: 'Meta Platforms Inc.',
  TSLA: 'Tesla Inc.',
  NFLX: 'Netflix Inc.',
  AMD: 'Advanced Micro Devices Inc.',
}

export async function GET() {
  try {
    const portfolio = JSON.parse(JSON.stringify(portfolioData)) as any

    // Fetch current prices for all position tickers in one batch
    const positions = portfolio.positions || []
    const tickers = [...new Set(positions.map((p: any) => p.ticker))]
    const priceMap: Record<string, number> = {}

    // Fetch all prices in parallel
    await Promise.all(
      tickers.map(async (ticker: string) => {
        try {
          const res = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, signal: AbortSignal.timeout(8000) }
          )
          if (res.ok) {
            const data = await res.json()
            const closes = (data.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
              .filter((v: any) => v !== null && v !== undefined && !isNaN(v))
            if (closes.length > 0) {
              priceMap[ticker] = closes[closes.length - 1]
            }
          }
        } catch {}
      })
    )

    // Update positions with live prices, fall back to avgCost if no price available
    const updatedPositions = positions.map((pos: any) => {
      const livePrice = priceMap[pos.ticker] || pos.avgCost
      return {
        ...pos,
        currentPrice: livePrice,
      }
    })

    // Calculate portfolio value (this IS the capital ceiling)
    const positionsValue = updatedPositions.reduce(
      (sum: number, pos: any) => sum + pos.shares * pos.currentPrice,
      0
    )
    const totalValue = portfolio.cash + positionsValue
    const totalReturn = totalValue - portfolio.startingCapital
    const totalReturnPct = (totalReturn / portfolio.startingCapital) * 100
    const now = new Date()
    const daysSinceStart = Math.floor((now.getTime() - new Date(portfolio.startDate).getTime()) / (1000 * 60 * 60 * 24))

    // Compute performance from closed positions
    const closedPositions: any[] = portfolio.closedPositions || []
    const winners = closedPositions.filter((cp: any) => cp.pnl > 0)
    const losers = closedPositions.filter((cp: any) => cp.pnl <= 0)
    const performance = {
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalReturnPct: Math.round(totalReturnPct * 100) / 100,
      winRate: closedPositions.length > 0 ? Math.round((winners.length / closedPositions.length) * 10000) / 100 : 0,
      avgWinPct: winners.length > 0 ? Math.round((winners.reduce((s: number, p: any) => s + p.pnlPct, 0) / winners.length) * 100) / 100 : 0,
      avgLossPct: losers.length > 0 ? Math.round((losers.reduce((s: number, p: any) => s + p.pnlPct, 0) / losers.length) * 100) / 100 : 0,
      bestTrade: closedPositions.length > 0 ? closedPositions.reduce((best: any, cp: any) => (!best || cp.pnlPct > best.pnlPct) ? cp : best, null) : null,
      worstTrade: closedPositions.length > 0 ? closedPositions.reduce((worst: any, cp: any) => (!worst || cp.pnlPct < worst.pnlPct) ? cp : worst, null) : null,
      totalTrades: closedPositions.length,
      profitableTrades: winners.length,
    }

    // Build per-position trade indicators
    const tradeIndicators = updatedPositions.map((pos: any) => {
      const daysHeld = Math.floor((now.getTime() - new Date(pos.buyDate).getTime()) / (1000 * 60 * 60 * 24))
      const unrealizedPnl = (pos.currentPrice - pos.avgCost) * pos.shares
      const unrealizedPct = pos.avgCost > 0 ? ((pos.currentPrice - pos.avgCost) / pos.avgCost) * 100 : 0
      return {
        ticker: pos.ticker,
        currentPrice: Math.round(pos.currentPrice * 100) / 100,
        avgCost: pos.avgCost,
        unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
        unrealizedPct: Math.round(unrealizedPct * 100) / 100,
        daysHeld,
        canTrade: daysHeld >= 3,
        signal: pos.signal,
      }
    })

    // Check cooldowns — expire old ones
    const cooldowns = portfolio.cooldowns || {}
    const validCooldowns: Record<string, string> = {}
    Object.entries(cooldowns).forEach(([ticker, expiryDate]) => {
      if (new Date(expiryDate as string) > now) {
        validCooldowns[ticker] = expiryDate as string
      }
    })

    // Value history for chart
    const valueHistory: any[] = portfolio.valueHistory || []

    // Enrich history with company names; for SELL trades, attach buy context and P&L
    const enrichedHistory = (portfolio.history || []).map((trade: any) => {
      const companyName = COMPANY_NAMES[trade.ticker] || trade.ticker
      const enriched: any = { ...trade, companyName }

      if (trade.action === 'SELL') {
        // Find matching closed position for P&L
        const closed = closedPositions.find(
          (cp: any) => cp.ticker === trade.ticker && cp.sellDate === trade.date
        )
        if (closed) {
          enriched.buyDate = closed.buyDate
          enriched.buyPrice = closed.buyPrice
          enriched.pnl = closed.pnl
          enriched.pnlPct = closed.pnlPct
          enriched.buyTotal = closed.buyPrice * closed.shares
        }
      }

      return enriched
    })

    // Enrich closed positions with company names
    const enrichedClosed = closedPositions.map((cp: any) => ({
      ...cp,
      companyName: COMPANY_NAMES[cp.ticker] || cp.ticker,
    }))

    // Enrich positions with company names
    const enrichedPositions = updatedPositions.map((pos: any) => ({
      ...pos,
      companyName: COMPANY_NAMES[pos.ticker] || pos.ticker,
    }))

    return NextResponse.json({
      ...portfolio,
      positions: enrichedPositions,
      history: enrichedHistory,
      closedPositions: enrichedClosed,
      cooldowns: validCooldowns,
      valueHistory,
      summary: {
        totalValue: Math.round(totalValue * 100) / 100,
        capitalCeiling: Math.round(totalValue * 100) / 100,
        cash: portfolio.cash,
        positionsValue: Math.round(positionsValue * 100) / 100,
        totalReturn: Math.round(totalReturn * 100) / 100,
        totalReturnPct: Math.round(totalReturnPct * 100) / 100,
        positionCount: updatedPositions.length,
        startDate: portfolio.startDate,
        daysSinceStart,
      },
      performance,
      tradeIndicators,
    })
  } catch (error) {
    console.error('Portfolio error:', error)
    return NextResponse.json({ error: 'Failed to load portfolio', debug: String(error) }, { status: 500 })
  }
}
