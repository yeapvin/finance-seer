import { NextResponse } from 'next/server'
import { getLiveQuote } from '@/lib/market-data'
import { readPortfolio } from '@/lib/portfolio-store'

export const dynamic = 'force-dynamic'

// Company name lookup
const COMPANY_NAMES: Record<string, string> = {
  AAPL: 'Apple', GOOGL: 'Alphabet', AMZN: 'Amazon', NVDA: 'NVIDIA',
  COST: 'Costco', MSFT: 'Microsoft', META: 'Meta', TSLA: 'Tesla',
  NFLX: 'Netflix', AMD: 'AMD', INTC: 'Intel', SNOW: 'Snowflake',
  ADSK: 'Autodesk', CRWV: 'CoreWeave', NBIS: 'Nebius', PLTR: 'Palantir',
  CRM: 'Salesforce', ADBE: 'Adobe', ORCL: 'Oracle', QCOM: 'Qualcomm',
  AVGO: 'Broadcom', MU: 'Micron', AMAT: 'Applied Materials',
  NET: 'Cloudflare', DDOG: 'Datadog', ZS: 'Zscaler', CRWD: 'CrowdStrike',
  PANW: 'Palo Alto Networks', COIN: 'Coinbase', PYPL: 'PayPal',
  JPM: 'JPMorgan', BAC: 'Bank of America', GS: 'Goldman Sachs',
  V: 'Visa', MA: 'Mastercard', XOM: 'ExxonMobil', CVX: 'Chevron',
  SPY: 'S&P 500 ETF', QQQ: 'Nasdaq 100 ETF', IWM: 'Russell 2000 ETF',
  DIA: 'Dow Jones ETF', VTI: 'Vanguard Total Market', VOO: 'Vanguard S&P 500',
  VGT: 'Vanguard Tech ETF', SOXX: 'Semiconductor ETF', ARKK: 'ARK Innovation ETF',
  XLK: 'Tech Select ETF', XLF: 'Financial Select ETF', XLE: 'Energy Select ETF',
  GLD: 'SPDR Gold ETF', SLV: 'iShares Silver ETF', GDX: 'Gold Miners ETF',
  USO: 'US Oil Fund', UNG: 'US Natural Gas Fund',
  BTC: 'Bitcoin (Spot)', IBIT: 'iShares Bitcoin ETF', GBTC: 'Grayscale Bitcoin',
  FBTC: 'Fidelity Bitcoin ETF', BITO: 'Bitcoin Strategy ETF',
}



export async function GET() {
  try {
    const portfolio = await readPortfolio()

    // Fetch current prices for all position + watchlist tickers
    const positions = portfolio.positions || []
    const watchlistItems = portfolio.watchlist || []
    const positionTickers = positions.map((p: any) => p.ticker)
    const watchlistTickers = watchlistItems.map((w: any) => w.ticker)
    const allTickers = [...new Set([...positionTickers, ...watchlistTickers])]
    
    // Fetch live prices via market-data (Finnhub primary)
    const priceResults = await Promise.allSettled(
      allTickers.map(async (ticker: unknown) => { const t = ticker as string;
        const q = await getLiveQuote(t)
        return { ticker: t.toUpperCase(), price: q?.price || null, changePct: q?.changePercent ?? null, name: q?.name || null }
      })
    )
    const priceMap: Record<string, number> = {}
    const changePctMap: Record<string, number> = {}
    const nameMap: Record<string, string> = {}
    priceResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value.price) {
        priceMap[r.value.ticker] = r.value.price
        if (r.value.changePct !== null) changePctMap[r.value.ticker] = r.value.changePct
        if (r.value.name) nameMap[r.value.ticker] = r.value.name
      }
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
    
    // Total cash (USD only)
    const cashByValue = portfolio.cashByValue || { USD: portfolio.cash || 0 }
    const totalCash = cashByValue.USD || 0
    
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
      if (NYSE_HOLIDAYS.includes(dateStr)) return false
      return true
    }

    const sgtNow = new Date(Date.now() + 8 * 60 * 60 * 1000) // UTC+8
    const todaySGT = sgtNow.toISOString().split('T')[0]
    const sgtHour = sgtNow.getUTCHours()
    const sgtMin = sgtNow.getUTCMinutes()
    const sgtTime = sgtHour * 100 + sgtMin
    const sgtDow = sgtNow.getUTCDay() // 0=Sun, 6=Sat

    // NYSE trading hours in SGT: Mon-Fri 21:30-04:00 (next calendar day)
    const inNYSE = (sgtDow >= 1 && sgtDow <= 5 && sgtTime >= 2130) ||
                   (sgtDow >= 2 && sgtDow <= 6 && sgtTime < 400)
    const marketsOpen = inNYSE

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
      watchlist: watchlistItems.map((w: any) => ({
        ...w,
        lastPrice: priceMap[w.ticker] ?? w.lastPrice ?? null,
        changePct: changePctMap[w.ticker] ?? w.changePct ?? null,
        companyName: nameMap[w.ticker] || COMPANY_NAMES[w.ticker] || w.companyName || null,
        lastChecked: new Date().toISOString(),
      })),
      cooldowns: {},
      valueHistory,
      cashByValue: {
        USD: cashByValue.USD || 0,
      },
      summary: {
        totalValue: Math.round(totalValue * 100) / 100,
        capitalCeiling: Math.round(totalValue * 100) / 100,
        cash: Math.round(totalCash * 100) / 100,
        cashUSD: Math.round((cashByValue.USD || 0) * 100) / 100,
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
