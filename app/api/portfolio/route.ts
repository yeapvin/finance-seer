import { NextResponse } from 'next/server'
import { getLiveQuote } from '@/lib/market-data'

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
  // SGX
  'DBS.SI': 'DBS Group Holdings',
  'UOB.SI': 'United Overseas Bank',
  'OCBC.SI': 'OCBC Bank',
  'SIA.SI': 'Singapore Airlines',
  'ST.SI': 'Singtel',
}



export async function GET() {
  try {
    const portfolio = JSON.parse(JSON.stringify(portfolioData)) as any

    // Use FX rates from portfolio.json (updated by monitor on market open)
    const fxRates = portfolio.fxRates || { SGDUSD: 0.7498 }

    // Fetch current prices for all position tickers
    const positions = portfolio.positions || []
    const tickers = [...new Set(positions.map((p: any) => p.ticker))]
    
    // Fetch live prices via market-data (Finnhub primary)
    const priceResults = await Promise.allSettled(
      tickers.map(async (ticker: unknown) => { const t = ticker as string;
        const q = await getLiveQuote(t)
        return { ticker: t.toUpperCase(), price: q?.price || null }
      })
    )
    const priceMap: Record<string, number> = {}
    priceResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value.price) priceMap[r.value.ticker] = r.value.price
    })

    // Update positions with live prices, fall back to avgCost if unavailable
    const updatedPositions = positions.map((pos: any) => {
      const livePrice = priceMap[pos.ticker.toUpperCase()] || pos.avgCost
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
    
    // Total cash: USD + (SGD / FX rate)
    const cashByValue = portfolio.cashByValue || { USD: portfolio.cash || 0, SGD: 0 }
    const sgdUsdConversion = fxRates.SGDUSD || 0.75
    const totalCash = (cashByValue.USD || 0) + ((cashByValue.SGD || 0) / sgdUsdConversion)
    
    const totalValue = totalCash + positionsValue
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
        signal: pos.signal,
        currency: pos.currency || 'USD',
      }
    })

    // Strategy notes: last 30 days only
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const recentStrategyNotes = (portfolio.strategyNotes || []).filter((n: any) => {
      const noteDate = (n.date || '').substring(0, 10)
      return noteDate >= thirtyDaysAgo
    })

    // Trade history: last 3 years only
    const threeYearsAgo = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const recentHistory = (portfolio.history || []).filter((t: any) => (t.date || '') >= threeYearsAgo)

    // Cooldowns removed — no longer used

    // Value history for chart
    // Rules:
    // 1. Only show trading days (Mon-Fri) — strip any weekend entries
    // 2. Past trading day snapshots written by cron are locked — never overwrite
    // 3. If today is a trading day and cron hasn't run yet, inject live value
    const SGX_HOLIDAYS = [
      '2025-01-01','2025-01-29','2025-01-30','2025-04-18','2025-05-01',
      '2025-05-12','2025-06-07','2025-08-09','2025-10-20','2025-12-25',
      '2026-01-01','2026-01-29','2026-01-30','2026-04-03','2026-05-01',
      '2026-05-31','2026-06-26','2026-08-10','2026-11-08','2026-12-25'
    ]
    const NYSE_HOLIDAYS = [
      '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26',
      '2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
      '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
      '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25'
    ]
    const isTradeDay = (dateStr: string) => {
      const d = new Date(dateStr)
      const dow = d.getUTCDay() // 0=Sun, 6=Sat
      if (dow === 0 || dow === 6) return false
      if (SGX_HOLIDAYS.includes(dateStr) && NYSE_HOLIDAYS.includes(dateStr)) return false
      return true
    }

    const sgtNow = new Date(Date.now() + 8 * 60 * 60 * 1000) // UTC+8
    const todaySGT = sgtNow.toISOString().split('T')[0]
    const sgtHour = sgtNow.getUTCHours()
    const sgtMin = sgtNow.getUTCMinutes()
    const sgtTime = sgtHour * 100 + sgtMin
    const sgtDow = sgtNow.getUTCDay() // 0=Sun, 6=Sat

    // Trading hours in SGT:
    //   SGX:  Mon-Fri 09:00-17:30
    //   NYSE: Mon-Fri 21:30-04:00 (next calendar day in SGT)
    const inSGX = sgtDow >= 1 && sgtDow <= 5 && sgtTime >= 900 && sgtTime < 1730
    const inNYSE = (sgtDow >= 1 && sgtDow <= 5 && sgtTime >= 2130) ||
                   (sgtDow >= 2 && sgtDow <= 6 && sgtTime < 400) // after midnight SGT
    const marketsOpen = inSGX || inNYSE

    // Strip non-trading days from history (in case any crept in)
    const valueHistory: any[] = (portfolio.valueHistory || []).filter((e: any) => isTradeDay(e.date))
    const lastEntry = valueHistory[valueHistory.length - 1]

    if (isTradeDay(todaySGT)) {
      if (marketsOpen) {
        // During trading hours: always show live value (overwrite any existing today entry)
        if (lastEntry && lastEntry.date === todaySGT) {
          valueHistory[valueHistory.length - 1] = { date: todaySGT, value: Math.round(totalValue * 100) / 100 }
        } else {
          valueHistory.push({ date: todaySGT, value: Math.round(totalValue * 100) / 100 })
        }
      } else if (!lastEntry || lastEntry.date !== todaySGT) {
        // After hours, no cron snapshot yet for today — inject live as best effort
        valueHistory.push({ date: todaySGT, value: Math.round(totalValue * 100) / 100 })
      }
      // After hours + cron already wrote today's snapshot → leave it locked
    }

    // Enrich history with company names; for SELL trades, attach buy context and P&L
    const enrichedHistory = recentHistory.map((trade: any) => {
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
      strategyNotes: recentStrategyNotes,
      watchlist: portfolio.watchlist || [],
      cooldowns: {},
      valueHistory,
      fxRates,
      cashByValue: {
        USD: cashByValue.USD || 0,
        SGD: cashByValue.SGD || 0,
      },
      summary: {
        totalValue: Math.round(totalValue * 100) / 100,
        capitalCeiling: Math.round(totalValue * 100) / 100,
        cash: Math.round(totalCash * 100) / 100,
        cashUSD: Math.round((cashByValue.USD || 0) * 100) / 100,
        cashSGD: Math.round((cashByValue.SGD || 0) * 100) / 100,
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
