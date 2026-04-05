import { NextResponse } from 'next/server'
import { readPortfolio, writePortfolio } from '@/lib/portfolio-store'

export const dynamic = 'force-dynamic'

// POST /api/watchlist  { ticker: "AAPL" }  → add
// DELETE /api/watchlist  { ticker: "AAPL" }  → remove

export async function POST(req: Request) {
  try {
    const { ticker } = await req.json()
    if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 })

    const portfolio = await readPortfolio()
    const watchlist = portfolio.watchlist || []
    const sym = ticker.toUpperCase().trim()

    if (watchlist.find((w: any) => w.ticker === sym)) {
      return NextResponse.json({ error: 'Already in watchlist' }, { status: 409 })
    }

    watchlist.push({ ticker: sym, addedDate: new Date().toISOString().split('T')[0] })
    portfolio.watchlist = watchlist
    await writePortfolio(portfolio)

    return NextResponse.json({ ok: true, watchlist })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { ticker } = await req.json()
    if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 })

    const portfolio = await readPortfolio()
    const sym = ticker.toUpperCase().trim()
    portfolio.watchlist = (portfolio.watchlist || []).filter((w: any) => w.ticker !== sym)
    await writePortfolio(portfolio)

    return NextResponse.json({ ok: true, watchlist: portfolio.watchlist })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
