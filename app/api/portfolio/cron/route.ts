/**
 * Scheduled portfolio monitor — called by Vercel Cron
 * Runs at NYSE open/mid/close (SGX trading discontinued)
 * Sends Telegram alerts for any actionable signals
 */
import { NextRequest, NextResponse } from 'next/server'
import { getLiveQuote, getHistoricalOHLCV } from '@/lib/market-data'
import { calculateAllIndicators } from '@/lib/indicators'
import { findSupportResistance, detectPatterns } from '@/lib/patterns'

async function getPositionAnalysis(ticker: string): Promise<string> {
  try {
    const history = await getHistoricalOHLCV(ticker, '3mo')
    if (!history || history.length < 30) return ''
    const prices = history.map((h: any) => h.close)
    const highs  = history.map((h: any) => h.high)
    const lows   = history.map((h: any) => h.low)
    const opens  = history.map((h: any) => h.open)
    const ind = calculateAllIndicators(prices, highs, lows)
    const { support, resistance } = findSupportResistance(prices)
    const patterns = detectPatterns(prices, { open: opens, high: highs, low: lows, close: prices })

    const last = (arr: number[] | undefined) => { const v = (arr || []).filter((x: number) => !isNaN(x)); return v[v.length-1] ?? 0 }
    const rsi  = last(ind.rsi)
    const macd = last(ind.macd)
    const macdSig = last(ind.macdSignal)
    const sma20 = last(ind.sma20)
    const sma50 = last(ind.sma50)
    const sma200 = last(ind.sma200)
    const currentPrice = prices[prices.length - 1]

    const topPatterns = patterns.slice(0, 3).map((p: any) => `${p.name} (${p.type})`).join(', ')
    const nearSupport = support.filter((s: number) => s < currentPrice).sort((a: number, b: number) => b - a)[0]
    const nearResist  = resistance.filter((r: number) => r > currentPrice).sort((a: number, b: number) => a - b)[0]

    return [
      `RSI ${rsi.toFixed(1)}${rsi < 30 ? ' (oversold)' : rsi > 70 ? ' (overbought)' : ''}`,
      `MACD ${macd > macdSig ? 'bullish' : 'bearish'} cross`,
      `SMA20 $${sma20.toFixed(2)} / SMA50 $${sma50.toFixed(2)} / SMA200 $${sma200.toFixed(2)}`,
      nearSupport ? `Support $${nearSupport.toFixed(2)}` : '',
      nearResist  ? `Resistance $${nearResist.toFixed(2)}` : '',
      topPatterns ? `Patterns: ${topPatterns}` : '',
    ].filter(Boolean).join(' | ')
  } catch { return '' }
}

async function getAICommentary(positions: any[], cashUSD: number, totalValue: number, totalReturnPct: number, spyPct: number, session: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  const apiUrl = process.env.OPENAI_API_URL || 'https://api.groq.com/openai/v1/chat/completions'
  if (!apiKey || positions.length === 0) return ''

  // Fetch technical analysis for each position
  const analyses = await Promise.all(positions.map((pos: any) => getPositionAnalysis(pos.ticker)))

  const positionLines = positions.map((pos: any, i: number) => {
    const price = pos.currentPrice || pos.buyPrice
    const cost = pos.avgCost || pos.buyPrice
    const pnlPct = cost > 0 ? ((price - cost) / cost * 100) : 0
    const distToTP = pos.takeProfit ? ((pos.takeProfit - price) / price * 100) : null
    const distToSL = pos.stopLoss ? ((price - pos.stopLoss) / price * 100) : null
    const tech = analyses[i] ? `\n  Technicals: ${analyses[i]}` : ''
    return `- ${pos.ticker} (${pos.shares}sh): $${price.toFixed(2)} | P&L ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% | SL $${pos.stopLoss?.toFixed(2)} (${distToSL?.toFixed(1)}% away) | TP $${pos.takeProfit?.toFixed(2)} (${distToTP?.toFixed(1)}% away)${tech}`
  }).join('\n')

  const prompt = `You are a senior portfolio manager reviewing positions at ${session}.

Portfolio: $${totalValue.toFixed(2)} | Return: ${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}% | Cash: $${cashUSD.toFixed(2)}
Market today: SPY ${spyPct >= 0 ? '+' : ''}${spyPct.toFixed(2)}%

Open positions with full technical context:
${positionLines}

Write a FLAGS section with 3-5 concise bullet points. For each relevant position give specific actionable commentary using the technical data — reference RSI, patterns, support/resistance levels by price. Say what to watch, whether to hold or consider exiting, bull/bear case. Comment on market conditions if relevant. Write like a senior trader briefing a client. Be specific, use actual numbers. Plain text only, no markdown.`

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 500
      })
    })
    if (!res.ok) return ''
    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() || ''
  } catch { return '' }
}

export const dynamic = 'force-dynamic'

async function sendTelegram(token: string, chatId: string, message: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
  })
}

function marketSession(): string {
  // Determine which market session this is (SGT = UTC+8)
  const now = new Date()
  const sgtHour = (now.getUTCHours() + 8) % 24
  const sgtMin = now.getUTCMinutes()
  const time = sgtHour * 100 + sgtMin

  if (time >= 2130 && time < 2200) return '🇺🇸 NYSE Open'
  if (time >= 100 && time < 130) return '🇺🇸 NYSE Mid-Session'
  if (time >= 400 && time < 430) return '🇺🇸 NYSE Close'
  return '📊 Scheduled Check'
}

// NYSE public holidays 2025-2026
const NYSE_HOLIDAYS = [
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26',
  '2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25'
]

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  // Check if today is a NYSE holiday
  const todayUTC = new Date().toISOString().split('T')[0]
  if (NYSE_HOLIDAYS.includes(todayUTC)) {
    console.log(`Skipping — NYSE holiday on ${todayUTC}`)
    return NextResponse.json({ skipped: true, reason: `NYSE holiday: ${todayUTC}` })
  }

  try {
    // Always use the stable production URL — VERCEL_URL is deployment-specific and unreliable
    const baseUrl = process.env.APP_URL || 'https://finance-seer.vercel.app'

    const res = await fetch(`${baseUrl}/api/portfolio/monitor`, { method: 'POST' })
    const result = await res.json()

    // Market closed — skip silently
    if (result.skipped) {
      return NextResponse.json({ success: true, skipped: true, reason: result.reason })
    }

    if (!result.success) {
      throw new Error('Monitor returned failure')
    }

    const executedTrades: any[] = result.executedTrades || []
    const nearMisses: any[] = result.nearMisses || []
    const positions: any[] = result.positions || []
    const totalValue: number = result.totalValue || 0
    const cashUSD: number = result.cashUSD || 0
    const startingCapital: number = result.startingCapital || 100000
    const startDate: string = result.startDate || ''
    const totalReturn = totalValue - startingCapital
    const totalReturnPct = (totalReturn / startingCapital * 100)
    const currentSession = marketSession()
    const isClose = currentSession.includes('Close')

    // Date for header
    const now = new Date()
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Singapore' })

    // Fetch SPY for market mood
    let spyPct = 0
    let marketMood = ''
    try {
      const spy = await getLiveQuote('SPY')
      if (spy) {
        spyPct = spy.changePercent
        if (spyPct <= -2) marketMood = `📉 SPY ${spyPct.toFixed(2)}% — broad selloff, stay defensive`
        else if (spyPct <= -1) marketMood = `📉 SPY ${spyPct.toFixed(2)}% — weak session`
        else if (spyPct >= 2) marketMood = `📈 SPY +${spyPct.toFixed(2)}% — strong rally`
        else if (spyPct >= 1) marketMood = `📈 SPY +${spyPct.toFixed(2)}% — positive session`
        else marketMood = `➡️ SPY ${spyPct >= 0 ? '+' : ''}${spyPct.toFixed(2)}% — flat/mixed`
      }
    } catch { /* skip */ }

    // Send Telegram summary
    if (token && chatId) {
      let msg = isClose
        ? `*📅 End-of-Day Summary — ${dateStr}*\n`
        : `*Finance Seer — ${currentSession}*\n`

      msg += `Portfolio: *$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}* | Return: ${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}% since ${startDate}\n`
      if (marketMood) msg += `${marketMood}\n`
      msg += '\n'

      // Trades
      if (executedTrades.length > 0) {
        msg += `⚡ *${executedTrades.length} Trade${executedTrades.length > 1 ? 's' : ''} Executed*\n`
        executedTrades.forEach((t: any) => {
          const emoji = t.type === 'BUY' ? '🟢' : '🔴'
          msg += `${emoji} ${t.type} *${t.ticker}* — ${t.shares} shares @ $${t.price?.toFixed(2)}\n`
          if (t.reason) msg += `   _${t.reason.replace(/[*_`]/g, '').substring(0, 120)}_\n`
        })
        msg += '\n'
      }

      // Position table
      if (positions.length > 0) {
        msg += `*Open Positions:*\n`
        for (const pos of positions) {
          const price = pos.currentPrice || pos.buyPrice
          const cost = pos.avgCost || pos.buyPrice
          const pnl = (price - cost) * pos.shares
          const pnlPct = cost > 0 ? ((price - cost) / cost * 100) : 0
          const sl = pos.stopLoss
          const tp = pos.takeProfit
          const distToTP = tp ? ((tp - price) / price * 100) : null
          const distToSL = sl ? ((price - sl) / price * 100) : null

          const emoji = pnlPct >= 0 ? '🟢' : '🔴'
          msg += `${emoji} *${pos.ticker}* (${pos.shares}sh) @ $${price.toFixed(2)} | ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% ($${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)})\n`
          msg += `   SL $${sl?.toFixed(2) || 'N/A'} | TP $${tp?.toFixed(2) || 'N/A'}`
          if (distToTP !== null && distToTP < 3) msg += ` | ⚠️ ${distToTP.toFixed(2)}% from TP`
          else if (distToSL !== null && distToSL < 5) msg += ` | ⚠️ ${distToSL.toFixed(2)}% from SL`
          msg += '\n'
        }
        msg += `💵 Cash: $${cashUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n`
      } else {
        msg += `No open positions.\n💵 Cash: $${cashUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n`
      }

      // AI-generated commentary
      const aiCommentary = await getAICommentary(positions, cashUSD, totalValue, totalReturnPct, spyPct, currentSession)
      if (aiCommentary) {
        msg += `*⚠️ Flags:*\n${aiCommentary}\n\n`
      }

      msg += `_finance-seer.vercel.app/portfolio_`
      await sendTelegram(token, chatId, msg)
    }

    return NextResponse.json({ success: true, session: currentSession, tradesExecuted: executedTrades.length })
  } catch (error) {
    console.error('Cron error:', error)

    // Alert on failure too
    if (token && chatId) {
      await sendTelegram(token, chatId, `⚠️ *Finance Seer* — Monitor check failed at ${marketSession()}. Please check the app.`)
    }

    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
