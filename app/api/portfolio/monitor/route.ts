/**
 * Portfolio Monitor — Full autonomous trading engine
 *
 * TRADING RULES:
 * 1. Max 5 open positions at any time
 * 2. Min 20% cash reserve always maintained
 * 3. Max 20% of total portfolio per position
 * 4. Max 2 positions per sector
 * 5. Min 1:2 risk/reward ratio before entry
 * 6. Trend filter: only long if price > SMA200 OR RSI < 30 (oversold reversal)
 * 7. Market condition check: conservative if SPY/STI down >1.5% on the day
 * 8. Earnings blackout: skip stocks with earnings within 3 days
 * 9. SGX-specific: wider SL/TP (-7%/+12%) vs US (-5%/+8%)
 * 10. Learning loop: boost weighting of successful signal types
 */
import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns, findSupportResistance } from '@/lib/patterns'
import { screenMarket, getCurrentMarketSession } from '@/lib/screener'
import { getHistoricalOHLCV, getNews } from '@/lib/market-data'

export const dynamic = 'force-dynamic'

const PORTFOLIO_PATH = join(process.cwd(), 'data', 'portfolio.json')

function readPortfolio() { return JSON.parse(readFileSync(PORTFOLIO_PATH, 'utf-8')) }
function writePortfolio(data: any) { writeFileSync(PORTFOLIO_PATH, JSON.stringify(data, null, 2)) }
function today() { return new Date().toISOString().split('T')[0] }
function nowISO() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }
function isSGX(ticker: string) { return ticker.endsWith('.SI') }
function getCurrency(ticker: string) { return isSGX(ticker) ? 'SGD' : 'USD' }
function fmt(n: number, currency = 'USD') { return `${currency} $${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

async function sendTelegram(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
    })
  } catch (e) { console.error('Telegram failed:', e) }
}

async function fetchFXRate(): Promise<number> {
  try {
    const apiKey = process.env.FINNHUB_API_KEY
    if (!apiKey) return 0.7498
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=OANDA:SGD_USD&token=${apiKey}`)
    const data = await res.json()
    return data.c || 0.7498
  } catch { return 0.7498 }
}

// ── Trading Rules Constants ──────────────────────────────────────────────────
const MAX_POSITIONS = 5
const MIN_CASH_RESERVE_PCT = 0.20   // Keep 20% cash
const MAX_POSITION_PCT = 0.20       // Max 20% per position
const MAX_SECTOR_POSITIONS = 2      // Max 2 per sector
const MIN_RISK_REWARD = 2.0         // Min 1:2 R/R
const MARKET_BEAR_THRESHOLD = -1.5  // % drop to trigger conservative mode

// Sector mapping
const SECTOR_MAP: Record<string, string> = {
  AAPL:'Tech',MSFT:'Tech',NVDA:'Tech',GOOGL:'Tech',GOOG:'Tech',META:'Tech',AMZN:'Tech',
  AMD:'Tech',INTC:'Tech',ORCL:'Tech',CRM:'Tech',ADBE:'Tech',NFLX:'Tech',QCOM:'Tech',
  TXN:'Tech',AVGO:'Tech',MU:'Tech',AMAT:'Tech',LRCX:'Tech',SNOW:'Tech',PLTR:'Tech',
  NET:'Tech',DDOG:'Tech',ZS:'Tech',CRWD:'Tech',PANW:'Tech',OKTA:'Tech',MDB:'Tech',
  COIN:'Crypto',TSLA:'EV',
  JPM:'Finance',BAC:'Finance',GS:'Finance',MS:'Finance',WFC:'Finance',C:'Finance',
  BLK:'Finance',SCHW:'Finance',V:'Finance',MA:'Finance',AXP:'Finance',PYPL:'Finance',
  JNJ:'Healthcare',PFE:'Healthcare',MRK:'Healthcare',ABBV:'Healthcare',LLY:'Healthcare',
  TMO:'Healthcare',ABT:'Healthcare',DHR:'Healthcare',BMY:'Healthcare',AMGN:'Healthcare',
  COST:'Consumer',WMT:'Consumer',TGT:'Consumer',HD:'Consumer',LOW:'Consumer',
  NKE:'Consumer',SBUX:'Consumer',MCD:'Consumer',YUM:'Consumer',
  XOM:'Energy',CVX:'Energy',COP:'Energy',SLB:'Energy',EOG:'Energy',
  CAT:'Industrial',DE:'Industrial',HON:'Industrial',GE:'Industrial',RTX:'Industrial',
  LMT:'Industrial',NOC:'Industrial',BA:'Industrial',UPS:'Industrial',FDX:'Industrial',
  SPY:'ETF',QQQ:'ETF',IWM:'ETF',DIA:'ETF',XLK:'ETF',XLF:'ETF',XLE:'ETF',
  XLV:'ETF',XLY:'ETF',ARKK:'ETF',VTI:'ETF',VOO:'ETF',VGT:'ETF',SOXX:'ETF',
  // SGX
  'D05.SI':'Finance','O39.SI':'Finance','U11.SI':'Finance',
  'Z74.SI':'Telecom','Y92.SI':'Telecom',
  'C6L.SI':'Transport','S58.SI':'Transport',
  'A17U.SI':'REIT','C38U.SI':'REIT','ME8U.SI':'REIT','N2IU.SI':'REIT',
}
function getSector(ticker: string): string {
  return SECTOR_MAP[ticker] || 'Other'
}

// Check if market is bearish today (SPY down >1.5%)
async function isMarketBearish(session: string): Promise<boolean> {
  try {
    const apiKey = process.env.FINNHUB_API_KEY
    if (!apiKey) return false
    const benchmark = session === 'SGX' ? 'ES3.SI' : 'SPY'
    const sym = benchmark.endsWith('.SI') ? benchmark.replace('.SI', ':SP') : benchmark
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${apiKey}`)
    const q = await res.json()
    if (!q.c || !q.pc) return false
    const changePct = ((q.c - q.pc) / q.pc) * 100
    return changePct < MARKET_BEAR_THRESHOLD
  } catch { return false }
}

// Check earnings within N days (Finnhub earnings calendar)
async function hasEarningsSoon(ticker: string, daysOut = 3): Promise<boolean> {
  try {
    const apiKey = process.env.FINNHUB_API_KEY
    if (!apiKey) return false
    const from = new Date().toISOString().split('T')[0]
    const to = new Date(Date.now() + daysOut * 86400000).toISOString().split('T')[0]
    const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${ticker}&token=${apiKey}`)
    const data = await res.json()
    return (data.earningsCalendar || []).length > 0
  } catch { return false }
}

// Self-tuning ATR multipliers based on trade outcomes
// Runs after enough closed trades to be statistically meaningful
function tuneATRMultipliers(portfolio: any): void {
  const closed = (portfolio.closedPositions || []).slice(-20) // Use last 20 trades
  if (closed.length < 5) return // Need at least 5 trades to tune

  const today = today_fn()
  const lastTuned = portfolio.atrMultipliers?.lastTuned
  // Only tune once per week to avoid over-fitting
  if (lastTuned) {
    const daysSince = Math.floor((Date.now() - new Date(lastTuned).getTime()) / 86400000)
    if (daysSince < 7) return
  }

  // Categorise exits
  const usExits = closed.filter((cp: any) => !isSGX(cp.ticker))
  const sgxExits = closed.filter((cp: any) => isSGX(cp.ticker))

  const tune = (exits: any[], market: 'US' | 'SGX') => {
    if (exits.length < 3) return
    const slHits = exits.filter((cp: any) => (cp.reason || '').toLowerCase().includes('stop-loss') || (cp.reason || '').toLowerCase().includes('stop loss')).length
    const tpHits = exits.filter((cp: any) => (cp.reason || '').toLowerCase().includes('take-profit') || (cp.reason || '').toLowerCase().includes('take profit')).length
    const total = slHits + tpHits
    if (total === 0) return

    const slRate = slHits / total
    const current = portfolio.atrMultipliers[market]

    // If SL being hit too often (>40%), widen SL multiplier
    // If TP rarely reached (<30% of exits are TP), tighten TP or widen SL
    // Adjust by max 0.1 per tuning cycle to avoid overcorrection
    const adjustment = 0.1
    let slAdj = 0, tpAdj = 0

    if (slRate > 0.4) {
      // Stops hit too often — widen SL
      slAdj = adjustment
    } else if (slRate < 0.2 && tpHits > slHits) {
      // TP hitting well, SL rarely touched — can tighten SL slightly
      slAdj = -adjustment * 0.5
    }

    const avgPnlPct = exits.reduce((s: number, cp: any) => s + (cp.pnlPct || 0), 0) / exits.length
    if (avgPnlPct > 5) {
      // Good returns — try to let winners run more (widen TP)
      tpAdj = adjustment
    } else if (avgPnlPct < 1) {
      // Poor returns — tighten TP to lock in smaller gains
      tpAdj = -adjustment
    }

    // Clamp to reasonable bounds
    const newSL = Math.max(1.0, Math.min(4.0, current.sl + slAdj))
    const newTP = Math.max(2.0, Math.min(8.0, current.tp + tpAdj))

    const changed = newSL !== current.sl || newTP !== current.tp
    if (changed) {
      portfolio.atrMultipliers[market] = { sl: parseFloat(newSL.toFixed(1)), tp: parseFloat(newTP.toFixed(1)) }
      portfolio.atrMultipliers.tuningHistory = [
        ...(portfolio.atrMultipliers.tuningHistory || []).slice(-10),
        {
          date: today,
          market,
          before: { sl: current.sl, tp: current.tp },
          after: { sl: newSL, tp: newTP },
          basedOn: `${exits.length} trades, SL hit rate ${(slRate*100).toFixed(0)}%, avg P&L ${avgPnlPct.toFixed(1)}%`
        }
      ]
    }
  }

  tune(usExits, 'US')
  tune(sgxExits, 'SGX')
  portfolio.atrMultipliers.lastTuned = today
}

function today_fn() { return new Date().toISOString().split('T')[0] }

// Build learning signal weights from closed trade history
function buildSignalWeights(portfolio: any): Record<string, number> {
  const closed = portfolio.closedPositions || []
  if (closed.length < 3) return {}
  const weights: Record<string, number> = {}
  // Analyse reasons of winning vs losing trades
  closed.forEach((cp: any) => {
    const won = cp.pnl > 0
    const reason = (cp.reason || '').toLowerCase()
    if (reason.includes('oversold') || reason.includes('rsi')) weights['rsi_oversold'] = (weights['rsi_oversold'] || 0) + (won ? 1 : -1)
    if (reason.includes('golden cross') || reason.includes('sma')) weights['moving_avg'] = (weights['moving_avg'] || 0) + (won ? 1 : -1)
    if (reason.includes('macd')) weights['macd'] = (weights['macd'] || 0) + (won ? 1 : -1)
    if (reason.includes('pattern') || reason.includes('flag') || reason.includes('triangle')) weights['pattern'] = (weights['pattern'] || 0) + (won ? 1 : -1)
    if (reason.includes('support')) weights['support'] = (weights['support'] || 0) + (won ? 1 : -1)
  })
  return weights
}

// Calculate ATR (Average True Range) for dynamic SL/TP
function calculateATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length < period + 1) return 0
  const trs: number[] = []
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    )
    trs.push(tr)
  }
  const recent = trs.slice(-period)
  return recent.reduce((a, b) => a + b, 0) / recent.length
}

// Use Groq LLM to make the final trading decision
async function getLLMDecision(prompt: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY
  const apiUrl = process.env.OPENAI_API_URL || 'https://api.groq.com/openai/v1/chat/completions'
  if (!apiKey) return null

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You are an expert quantitative trader and portfolio manager. 
You analyse stocks using technical indicators, chart patterns, and news sentiment.
You make precise, data-driven trading decisions with specific price targets.
Always respond with valid JSON only — no markdown, no explanation outside the JSON.`
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2048
      })
    })
    if (!res.ok) return null
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''
    const match = content.match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0]) : null
  } catch { return null }
}

async function analyseStock(ticker: string, portfolio: any, apiKey: string): Promise<any> {
  const [history, newsItems] = await Promise.all([
    getHistoricalOHLCV(ticker, '6mo'),
    getNews(ticker)
  ])
  if (!history || history.length < 50) return null

  const prices = history.map((h: any) => h.close)
  const highs = history.map((h: any) => h.high)
  const lows = history.map((h: any) => h.low)
  const volumes = history.map((h: any) => h.volume)
  const currentPrice = prices[prices.length - 1]
  const newsHeadlines = newsItems.map((n: any) => n.headline)
  const posNews = newsItems.filter((n: any) => n.sentiment === 'positive').length
  const negNews = newsItems.filter((n: any) => n.sentiment === 'negative').length
  const sentimentScore = newsItems.length > 0 ? (posNews - negNews) / newsItems.length : 0
  const indicators = calculateAllIndicators(prices, highs, lows)
  // Cap patterns to last 6 months (~126 trading days)
  const SIX_MONTHS = 126
  const rp = prices.slice(-SIX_MONTHS), rh = highs.slice(-SIX_MONTHS), rl = lows.slice(-SIX_MONTHS)
  const patterns = detectPatterns(rp, { open: rp, high: rh, low: rl, close: rp })
  const { support, resistance } = findSupportResistance(prices)

  const last = (arr: number[] | undefined) => arr?.filter(v => !isNaN(v)).slice(-1)[0] ?? 0
  const lastBB = (arr: Array<{upper:number;middle:number;lower:number}> | undefined) => {
    const v = arr?.filter(v => !isNaN(v.middle)).slice(-1)[0]
    return v ?? { upper: 0, middle: 0, lower: 0 }
  }
  const lastStoch = (arr: Array<{k:number;d:number}> | undefined) => {
    const v = arr?.filter(v => !isNaN(v.k)).slice(-1)[0]
    return v ?? { k: 50, d: 50 }
  }

  const rsi = last(indicators.rsi)
  const macd = last(indicators.macd)
  const macdSignal = last(indicators.macdSignal)
  const macdHist = last(indicators.macdHistogram)
  const sma20 = last(indicators.sma20)
  const sma50 = last(indicators.sma50)
  const sma200 = last(indicators.sma200)
  const ema12 = last(indicators.ema12)
  const ema26 = last(indicators.ema26)
  const bb = lastBB(indicators.bollingerBands)
  const stoch = lastStoch(indicators.stochastic)
  const atr = calculateATR(highs, lows, prices)
  const currency = getCurrency(ticker)

  // Portfolio context for LLM
  const closed = (portfolio.closedPositions || []).slice(-10)
  const held = (portfolio.positions || []).map((p: any) => p.ticker)
  const winRate = closed.length > 0
    ? (closed.filter((p: any) => p.pnl > 0).length / closed.length * 100).toFixed(0)
    : 'N/A'

  const prompt = `Analyse ${ticker} (${currency}) for a portfolio currently worth ~$${
    ((portfolio.cashByValue?.USD || 0) + (portfolio.positions || []).reduce((s: number, p: any) => s + p.currentPrice * p.shares, 0)).toFixed(0)
  } USD with ${(portfolio.cashByValue?.USD || 0).toFixed(0)} USD cash available.

CURRENT PRICE: ${currentPrice.toFixed(2)} ${currency}
POSITION STATUS: ${held.includes(ticker) ? 'CURRENTLY HELD' : 'NOT HELD'}

TECHNICAL INDICATORS:
- RSI(14): ${rsi.toFixed(1)} ${rsi < 30 ? '← OVERSOLD' : rsi > 70 ? '← OVERBOUGHT' : ''}
- MACD: ${macd.toFixed(4)} | Signal: ${macdSignal.toFixed(4)} | Histogram: ${macdHist.toFixed(4)} ${macd > macdSignal ? '← BULLISH CROSS' : '← BEARISH CROSS'}
- SMA20: ${sma20.toFixed(2)} | SMA50: ${sma50.toFixed(2)} | SMA200: ${sma200.toFixed(2)}
- EMA12: ${ema12.toFixed(2)} | EMA26: ${ema26.toFixed(2)}
- Bollinger Bands: Upper ${bb.upper.toFixed(2)} | Mid ${bb.middle.toFixed(2)} | Lower ${bb.lower.toFixed(2)}
- Price vs BB: ${currentPrice > bb.upper ? 'ABOVE upper (overbought)' : currentPrice < bb.lower ? 'BELOW lower (oversold)' : 'Within bands'}
- Stochastic K: ${stoch.k.toFixed(1)} | D: ${stoch.d.toFixed(1)} ${stoch.k < 20 ? '← OVERSOLD' : stoch.k > 80 ? '← OVERBOUGHT' : ''}
- ATR(14): ${atr.toFixed(2)} (volatility measure)

CHART PATTERNS DETECTED (${patterns.length}):
${patterns.length > 0 ? patterns.map(p => `- ${p.name} (${p.confidence.toFixed(0)}% confidence, ${p.type})`).join('\n') : '- None detected'}

SUPPORT LEVELS: ${support.slice(0,3).map(s => s.toFixed(2)).join(', ') || 'N/A'}
RESISTANCE LEVELS: ${resistance.slice(0,3).map(r => r.toFixed(2)).join(', ') || 'N/A'}

NEWS SENTIMENT: ${sentimentScore > 0.2 ? 'POSITIVE' : sentimentScore < -0.2 ? 'NEGATIVE' : 'NEUTRAL'} (score: ${sentimentScore.toFixed(2)})
RECENT HEADLINES:
${newsHeadlines.slice(0, 5).map(h => `- ${h}`).join('\n') || '- No recent news'}

PORTFOLIO LEARNING:
- Historical win rate: ${winRate}%
- Recent closed trades: ${closed.map((p: any) => `${p.ticker} ${p.pnl >= 0 ? '+' : ''}${p.pnlPct?.toFixed(1)}%`).join(', ') || 'None'}

Based on ALL of the above, provide your trading decision as JSON:
{
  "action": "BUY" | "SELL" | "HOLD",
  "conviction": "HIGH" | "MEDIUM" | "LOW",
  "entryPrice": <number or null>,
  "stopLoss": <price — set dynamically using ATR and nearest support, NOT a fixed %>,
  "takeProfit": <price — set dynamically using ATR and nearest resistance, NOT a fixed %>,
  "strategy": "<concise trading strategy: entry rationale, what to watch, time horizon>",
  "reason": "<specific reason matching style: 'Contrarian buy at support $X. RSI Y (oversold). SMA20 $Z. Resistance $W.'>",
  "riskRewardRatio": <number>
}`

  const llmDecision = await getLLMDecision(prompt)

  return {
    ticker,
    currentPrice,
    currency,
    rsi,
    atr,
    support,
    resistance,
    patterns,
    sentimentScore,
    newsHeadlines,
    llmDecision,
    indicators: { rsi, macd, macdSignal, sma20, sma50, sma200, bb, stoch, atr }
  }
}

export async function POST() {
  try {
    const portfolio = readPortfolio()
    const apiKey = process.env.FINNHUB_API_KEY || ''
    const fxRate = await fetchFXRate()
    portfolio.fxRates = { SGDUSD: fxRate, lastUpdated: nowISO() }

    const session = getCurrentMarketSession()
    if (session === 'CLOSED') {
      return NextResponse.json({ success: true, skipped: true, reason: 'Market closed' })
    }

    // Self-tune ATR multipliers based on recent trade history
    tuneATRMultipliers(portfolio)

    const cashUSD = portfolio.cashByValue?.USD || 0
    const cashSGD = portfolio.cashByValue?.SGD || 0
    const posValueUSD = (portfolio.positions || [])
      .filter((p: any) => !isSGX(p.ticker))
      .reduce((s: number, p: any) => s + (p.currentPrice || p.buyPrice) * p.shares, 0)
    const posValueSGD = (portfolio.positions || [])
      .filter((p: any) => isSGX(p.ticker))
      .reduce((s: number, p: any) => s + (p.currentPrice || p.buyPrice) * p.shares, 0)
    const totalPortfolioUSD = cashUSD + posValueUSD + (cashSGD + posValueSGD) * fxRate
    const maxPositionUSD = totalPortfolioUSD * 0.20

    const executedTrades: any[] = []
    const todayStr = today()

    // ── STEP 1: Check existing positions ──────────────────────────────────────
    for (const pos of [...portfolio.positions]) {
      const analysis = await analyseStock(pos.ticker, portfolio, apiKey)
      if (!analysis) continue

      const { currentPrice, llmDecision, currency } = analysis
      const posIdx = portfolio.positions.findIndex((p: any) => p.ticker === pos.ticker)
      if (posIdx >= 0) portfolio.positions[posIdx].currentPrice = currentPrice

      const stopLossPrice = pos.stopLoss || currentPrice * 0.95
      const takeProfitPrice = pos.takeProfit || currentPrice * 1.08

      // Hard stops always take priority over LLM
      if (currentPrice <= stopLossPrice) {
        await executeTrade(portfolio, 'SELL', pos, currentPrice, `Stop-loss triggered at ${fmt(currentPrice, currency)}. Buy was ${fmt(pos.buyPrice, currency)}. Loss: ${(((currentPrice - pos.buyPrice) / pos.buyPrice) * 100).toFixed(2)}%.`, executedTrades, fxRate)
        continue
      }
      if (currentPrice >= takeProfitPrice) {
        await executeTrade(portfolio, 'SELL', pos, currentPrice, `Take-profit hit at ${fmt(currentPrice, currency)} (TP: ${fmt(takeProfitPrice, currency)}). Profit: +${(((currentPrice - pos.buyPrice) / pos.buyPrice) * 100).toFixed(2)}%.`, executedTrades, fxRate)
        continue
      }

      // LLM says sell
      if (llmDecision?.action === 'SELL' && llmDecision?.conviction !== 'LOW') {
        await executeTrade(portfolio, 'SELL', pos, currentPrice, llmDecision.reason || `LLM sell signal. ${llmDecision.strategy || ''}`, executedTrades, fxRate)
      }
    }

    // ── STEP 2: Screen full market for opportunities ───────────────────────────

    // Rule 1: Max positions check
    const currentPositionCount = portfolio.positions.length
    if (currentPositionCount >= MAX_POSITIONS) {
      console.log(`Max positions (${MAX_POSITIONS}) reached, skipping buys`)
    } else {

      // Rule 2: Cash reserve check — must keep 20% cash
      const minCashUSD = totalPortfolioUSD * MIN_CASH_RESERVE_PCT
      const deployableUSD = Math.max(0, cashUSD - minCashUSD)
      const deployableSGD = Math.max(0, cashSGD - (minCashUSD / fxRate))

      if (deployableUSD < 2000 && deployableSGD < 2000) {
        console.log('Cash reserve limit reached, skipping buys')
      } else {

        // Rule 6: Market condition check
        const bearMarket = await isMarketBearish(session)
        const signalThreshold = bearMarket ? 'STRONG_BUY' : 'BUY'

        const screenResults = await screenMarket(session, apiKey, 60)
        const heldTickers = portfolio.positions.map((p: any) => p.ticker)

        // Rule 4: Build sector counts from current positions
        const sectorCounts: Record<string, number> = {}
        portfolio.positions.forEach((p: any) => {
          const s = getSector(p.ticker)
          sectorCounts[s] = (sectorCounts[s] || 0) + 1
        })

        // Build learning weights
        const signalWeights = buildSignalWeights(portfolio)

        const buyOpportunities = screenResults
          .filter(r => (bearMarket ? r.signal === 'STRONG_BUY' : (r.signal === 'STRONG_BUY' || r.signal === 'BUY'))
            && !heldTickers.includes(r.ticker))
          .slice(0, 10)

        for (const candidate of buyOpportunities) {
          const currency = candidate.currency
          const availableCash = currency === 'SGD' ? deployableSGD : deployableUSD
          if (availableCash < 2000) continue
          if (executedTrades.filter(t => t.type === 'BUY').length >= 2) break
          if (currentPositionCount + executedTrades.filter(t => t.type === 'BUY').length >= MAX_POSITIONS) break

          // Rule 4: Sector concentration
          const sector = getSector(candidate.ticker)
          if ((sectorCounts[sector] || 0) >= MAX_SECTOR_POSITIONS) continue

          // Rule 7: Earnings blackout
          const earningsSoon = await hasEarningsSoon(candidate.ticker)
          if (earningsSoon) {
            console.log(`Skipping ${candidate.ticker} — earnings within 3 days`)
            continue
          }

          const analysis = await analyseStock(candidate.ticker, portfolio, apiKey)
          if (!analysis?.llmDecision) continue

          const { llmDecision, currentPrice, rsi } = analysis
          if (llmDecision.action !== 'BUY' || llmDecision.conviction === 'LOW') continue

          // Rule 6: Trend filter — only buy if price > SMA200 OR RSI < 30
          const sma200 = analysis.indicators.sma200
          const aboveSMA200 = sma200 > 0 && currentPrice > sma200
          const oversold = rsi < 30
          if (!aboveSMA200 && !oversold) {
            console.log(`Skipping ${candidate.ticker} — below SMA200 and not oversold (RSI ${rsi.toFixed(0)})`)
            continue
          }

          // Rule 9: ATR-based SL/TP using self-tuning multipliers
          const isSGXStock = isSGX(candidate.ticker)
          const atr = analysis.atr
          const marketKey = isSGXStock ? 'SGX' : 'US'
          const multipliers = portfolio.atrMultipliers?.[marketKey] || (isSGXStock ? { sl: 2.0, tp: 4.0 } : { sl: 1.5, tp: 3.0 })
          // LLM-provided levels (based on S/R) take priority over ATR fallback
          const sl = llmDecision.stopLoss || Math.max(currentPrice - atr * multipliers.sl, currentPrice * 0.85)
          const tp = llmDecision.takeProfit || Math.min(currentPrice + atr * multipliers.tp, currentPrice * 1.30)

          // Rule 5: Min 1:2 risk/reward
          const risk = currentPrice - sl
          const reward = tp - currentPrice
          const rr = risk > 0 ? reward / risk : 0
          if (rr < MIN_RISK_REWARD) {
            console.log(`Skipping ${candidate.ticker} — R/R ${rr.toFixed(2)} < min ${MIN_RISK_REWARD}`)
            continue
          }

          // Apply learning weight boost to reason
          const dominantSignal = Object.entries(signalWeights).sort((a,b) => b[1]-a[1])[0]
          const learnNote = dominantSignal && dominantSignal[1] > 1 ? ` Historical edge: ${dominantSignal[0].replace('_',' ')}.` : ''

          // Rule 3: Position sizing (20% max)
          const maxInCurrency = currency === 'SGD' ? maxPositionUSD / fxRate : maxPositionUSD
          const positionSize = Math.min(availableCash, maxInCurrency)
          const shares = Math.floor(positionSize / currentPrice)
          if (shares <= 0) continue

          const reason = `${llmDecision.reason || `Technical buy at ${fmt(currentPrice, currency)}. RSI ${rsi.toFixed(0)}.`}${learnNote} R/R: 1:${rr.toFixed(1)}.`

          await executeBuy(portfolio, candidate.ticker, shares, currentPrice, sl, tp, currency,
            reason, llmDecision.strategy || '', executedTrades, fxRate
          )

          // Update sector count
          sectorCounts[sector] = (sectorCounts[sector] || 0) + 1
        }
      }
    }

    // ── STEP 3: Update value history ──────────────────────────────────────────
    const newPosValueUSD = portfolio.positions.filter((p: any) => !isSGX(p.ticker)).reduce((s: number, p: any) => s + p.currentPrice * p.shares, 0)
    const newPosValueSGD = portfolio.positions.filter((p: any) => isSGX(p.ticker)).reduce((s: number, p: any) => s + p.currentPrice * p.shares, 0)
    const newTotalUSD = (portfolio.cashByValue?.USD || 0) + newPosValueUSD + ((portfolio.cashByValue?.SGD || 0) + newPosValueSGD) * fxRate
    const lastEntry = portfolio.valueHistory?.[portfolio.valueHistory.length - 1]
    if (!lastEntry || lastEntry.date !== todayStr) {
      portfolio.valueHistory = [...(portfolio.valueHistory || []), { date: todayStr, value: newTotalUSD }]
    } else {
      portfolio.valueHistory[portfolio.valueHistory.length - 1].value = newTotalUSD
    }

    // ── STEP 4: Watchlist alerts ──────────────────────────────────────────────
    const watchlist = portfolio.watchlist || []
    const watchlistAlerts: any[] = []

    for (const item of watchlist) {
      try {
        const apiKey = process.env.FINNHUB_API_KEY || ''
        const sym = finnhubSymbol(item.ticker)
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${apiKey}`)
        const q = await res.json()
        if (!q.c || !q.pc) continue

        const price = q.c
        const prevClose = q.pc
        const changePct = ((price - prevClose) / prevClose) * 100
        const threshold = item.alertThreshold || 5

        // Update last known price
        item.lastPrice = price
        item.lastChecked = nowISO()
        item.changePct = parseFloat(changePct.toFixed(2))

        if (Math.abs(changePct) >= threshold) {
          const emoji = changePct >= 0 ? '📈' : '📉'
          const alert = `${emoji} *Watchlist: ${item.ticker}*\n${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% today @ $${price.toFixed(2)}\n_${item.note || ''}_`
          await sendTelegram(alert)
          watchlistAlerts.push({ ticker: item.ticker, price, changePct })
        }
      } catch (e) {
        console.error(`Watchlist error for ${item.ticker}:`, e)
      }
    }

    portfolio.watchlist = watchlist
    writePortfolio(portfolio)

    return NextResponse.json({
      success: true,
      session,
      executedTrades,
      watchlistAlerts,
      totalValue: newTotalUSD,
      fxRate
    })
  } catch (error) {
    console.error('Monitor error:', error)
    return NextResponse.json({ error: 'Monitor failed' }, { status: 500 })
  }
}

async function executeTrade(portfolio: any, type: 'SELL', pos: any, price: number, reason: string, executedTrades: any[], fxRate: number) {
  const todayStr = today()
  const currency = getCurrency(pos.ticker)
  const proceeds = price * pos.shares
  const pnl = (price - pos.buyPrice) * pos.shares
  const pnlPct = ((price - pos.buyPrice) / pos.buyPrice) * 100
  const note = `${reason} Profit: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%).`

  portfolio.history = portfolio.history || []
  portfolio.history.push({ date: todayStr, action: 'SELL', ticker: pos.ticker, shares: pos.shares, price, total: proceeds, reason: note, buyDate: pos.buyDate, buyPrice: pos.buyPrice, pnl, pnlPct, currency })

  portfolio.closedPositions = portfolio.closedPositions || []
  portfolio.closedPositions.push({ ticker: pos.ticker, shares: pos.shares, buyDate: pos.buyDate, buyPrice: pos.buyPrice, sellDate: todayStr, sellPrice: price, reason: note, pnl, pnlPct, currency })

  portfolio.cashByValue = portfolio.cashByValue || { USD: 0, SGD: 0 }
  portfolio.cashByValue[currency] = (portfolio.cashByValue[currency] || 0) + proceeds

  const posIdx = portfolio.positions.findIndex((p: any) => p.ticker === pos.ticker)
  if (posIdx >= 0) portfolio.positions.splice(posIdx, 1)


  portfolio.strategyNotes = portfolio.strategyNotes || []
  portfolio.strategyNotes.push({ date: nowISO(), note: `Sold ${pos.ticker} @ ${fmt(price, currency)} (${pos.shares} shares). ${note} Cash now ${fmt(portfolio.cashByValue[currency], currency)}.` })

  executedTrades.push({ type: 'SELL', ticker: pos.ticker, shares: pos.shares, price, proceeds, pnl, pnlPct, currency, reason: note })

  const emoji = pnl >= 0 ? '🟢' : '🔴'
  await sendTelegram(`${emoji} *Finance Seer — SELL*\n\n*${pos.ticker}* ${pos.shares} shares @ ${fmt(price, currency)}\nP&L: ${pnl >= 0 ? '+' : ''}${fmt(Math.abs(pnl), currency)} (${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)\n\n_${note.substring(0, 200)}_`)
}

async function executeBuy(portfolio: any, ticker: string, shares: number, price: number, sl: number, tp: number, currency: string, reason: string, strategy: string, executedTrades: any[], fxRate: number) {
  const todayStr = today()
  const cost = price * shares

  portfolio.cashByValue = portfolio.cashByValue || { USD: 0, SGD: 0 }
  portfolio.cashByValue[currency] = (portfolio.cashByValue[currency] || 0) - cost

  portfolio.positions = portfolio.positions || []
  portfolio.positions.push({ ticker, shares, avgCost: price, buyDate: todayStr, buyPrice: price, currentPrice: price, stopLoss: sl, takeProfit: tp, signal: 'BUY', reason, currency })

  portfolio.history = portfolio.history || []
  portfolio.history.push({ date: todayStr, action: 'BUY', ticker, shares, price, total: cost, reason, currency })

  portfolio.strategyNotes = portfolio.strategyNotes || []
  portfolio.strategyNotes.push({ date: nowISO(), note: `Bought ${shares} ${ticker} @ ${fmt(price, currency)} (-${fmt(cost, currency)}). ${reason}${strategy ? ' Strategy: ' + strategy : ''} SL: ${fmt(sl, currency)}, TP: ${fmt(tp, currency)}. Cash now ${fmt(portfolio.cashByValue[currency], currency)}.` })

  executedTrades.push({ type: 'BUY', ticker, shares, price, cost, sl, tp, currency, reason, strategy })

  await sendTelegram(`🟢 *Finance Seer — BUY*\n\n*${ticker}* ${shares} shares @ ${fmt(price, currency)}\nCost: ${fmt(cost, currency)}\nSL: ${fmt(sl, currency)} | TP: ${fmt(tp, currency)}\n\n_${reason.substring(0, 200)}_`)
}
