import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q') || ''
    if (!query || query.length < 1) return NextResponse.json([])

    const apiKey = process.env.FINNHUB_API_KEY
    if (!apiKey) return NextResponse.json([])

    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${apiKey}`
    )
    if (!res.ok) return NextResponse.json([])

    const data = await res.json()
    const results = (data.result || [])
      .filter((r: any) => {
        const type = r.type || ''
        const sym: string = r.symbol || ''
        // Equities and ETFs only; prefer US listings
        return (type === 'Common Stock' || type === 'ETP') &&
          !sym.includes('.')
      })
      .slice(0, 10)
      .map((r: any) => ({
        symbol: r.symbol,
        description: r.description,
        type: r.type,
      }))

    return NextResponse.json(results)
  } catch {
    return NextResponse.json([])
  }
}
