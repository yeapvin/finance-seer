import { NextRequest, NextResponse } from 'next/server'
import { searchTickers } from '@/lib/market-data'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q') || ''
    if (!query || query.length < 1) return NextResponse.json([])
    const results = await searchTickers(query)
    return NextResponse.json(results)
  } catch {
    return NextResponse.json([])
  }
}
