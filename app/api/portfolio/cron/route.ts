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
    // Run the monitor
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://finance-seer.vercel.app'

    const res = await fetch(`${baseUrl}/api/portfolio/monitor`, { method: 'POST' })
    const result = await res.json()

    if (!result.success) {
      throw new Error('Monitor failed')
    }

    const { actions, summary, fxRate } = result
    const session = marketSession()

    const urgent = actions.filter((a: any) => a.urgent)
    const sells = actions.filter((a: any) => a.type === 'SELL' && !a.urgent)
    const buys = actions.filter((a: any) => a.type === 'BUY')
    const holds = actions.filter((a: any) => a.type === 'HOLD')
    const toExecute = [...urgent, ...sells, ...buys]

    // Auto-execute all BUY and SELL signals
    const executed: any[] = []
    for (const action of toExecute) {
      try {
        const execRes = await fetch(`${baseUrl}/api/portfolio/monitor`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        })
        const execResult = await execRes.json()
        if (execResult.success) executed.push(action)
      } catch (e) {
        console.error(`Failed to execute ${action.type} ${action.ticker}:`, e)
      }
    }

    // Send Telegram summary
    if (token && chatId) {
      let msg = `*Finance Seer — ${session}*\n`
      msg += `Portfolio: USD $${summary?.totalValueUSD?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) || 'N/A'} | SGD/USD: ${fxRate?.toFixed(4) || 'N/A'}\n\n`

      if (executed.length > 0) {
        msg += `⚡ *${executed.length} Trade${executed.length > 1 ? 's' : ''} Executed*\n`
        executed.forEach((a: any) => {
          const emoji = a.type === 'BUY' ? '🟢' : '🔴'
          msg += `${emoji} ${a.type} ${a.ticker} — ${a.shares} shares @ ${a.currency} $${a.currentPrice?.toFixed(2)}\n`
          msg += `   _${a.reason.replace(/[*_`]/g, '').substring(0, 80)}_\n`
        })
        msg += '\n'
      } else {
        msg += `✅ All ${holds.length} positions HOLD — no action needed.\n`
      }

      msg += `_View portfolio: finance-seer.vercel.app/portfolio_`
      await sendTelegram(token, chatId, msg)
    }

    return NextResponse.json({ success: true, session, actionsFound: actions.length })
  } catch (error) {
    console.error('Cron error:', error)

    // Alert on failure too
    if (token && chatId) {
      await sendTelegram(token, chatId, `⚠️ *Finance Seer* — Monitor check failed at ${marketSession()}. Please check the app.`)
    }

    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
