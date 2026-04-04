/**
 * Scheduled portfolio monitor — called by Vercel Cron
 * Runs at SGX open/mid/close and NYSE open/mid/close
 * Sends Telegram alerts for any actionable signals
 */
import { NextRequest, NextResponse } from 'next/server'

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

  if (time >= 900 && time < 930) return '🇸🇬 SGX Open'
  if (time >= 1200 && time < 1230) return '🇸🇬 SGX Mid-Session'
  if (time >= 1700 && time < 1730) return '🇸🇬 SGX Close'
  if (time >= 2130 && time < 2200) return '🇺🇸 NYSE Open'
  if (time >= 100 && time < 130) return '🇺🇸 NYSE Mid-Session'
  if (time >= 400 && time < 430) return '🇺🇸 NYSE Close'
  return '📊 Scheduled Check'
}

// SGX public holidays 2025-2026 (YYYY-MM-DD)
const SGX_HOLIDAYS = [
  '2025-01-01','2025-01-29','2025-01-30','2025-04-18','2025-05-01',
  '2025-05-12','2025-06-07','2025-08-09','2025-10-20','2025-12-25',
  '2026-01-01','2026-01-29','2026-01-30','2026-04-03','2026-05-01',
  '2026-05-31','2026-06-26','2026-08-10','2026-11-08','2026-12-25'
]

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

  // Check if today is a market holiday
  const todayUTC = new Date().toISOString().split('T')[0]
  const session = marketSession()
  const isSGXSession = session.includes('SGX')
  const isNYSESession = session.includes('NYSE')
  const isSGXHoliday = SGX_HOLIDAYS.includes(todayUTC)
  const isNYSEHoliday = NYSE_HOLIDAYS.includes(todayUTC)

  if ((isSGXSession && isSGXHoliday) || (isNYSESession && isNYSEHoliday)) {
    console.log(`Skipping ${session} — market holiday on ${todayUTC}`)
    return NextResponse.json({ skipped: true, reason: `Market holiday: ${todayUTC}` })
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
    const totalValue: number = result.totalValue || 0
    const fxRate: number = result.fxRate || 0
    const currentSession = marketSession()

    // Send Telegram summary
    if (token && chatId) {
      let msg = `*Finance Seer — ${currentSession}*\n`
      msg += `Portfolio: USD $${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}${fxRate ? ` | SGD/USD: ${fxRate.toFixed(4)}` : ''}\n\n`

      if (executedTrades.length > 0) {
        msg += `⚡ *${executedTrades.length} Trade${executedTrades.length > 1 ? 's' : ''} Executed*\n`
        executedTrades.forEach((t: any) => {
          const emoji = t.type === 'BUY' ? '🟢' : '🔴'
          msg += `${emoji} ${t.type} *${t.ticker}* — ${t.shares} shares @ ${t.currency} $${t.price?.toFixed(2)}\n`
          if (t.reason) msg += `   _${t.reason.replace(/[*_`]/g, '').substring(0, 100)}_\n`
        })
        msg += '\n'
      } else {
        msg += `✅ No trades executed — all positions holding.\n`
      }

      msg += `_View: finance-seer.vercel.app/portfolio_`
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
