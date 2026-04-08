/**
 * Shared Telegram helper
 */
export async function sendTelegram(message: string, buttons?: { text: string; callback_data: string }[][]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  try {
    const body: any = { chat_id: chatId, text: message, parse_mode: 'Markdown' }
    if (buttons) body.reply_markup = { inline_keyboard: buttons }
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) { console.error('Telegram failed:', e) }
}

export const NYSE_HOLIDAYS = [
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26',
  '2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
]
