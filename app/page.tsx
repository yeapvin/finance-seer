'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Loader, Zap, AlertTriangle, Briefcase } from 'lucide-react'
import { StockChart } from '@/components/StockChart'
import { IndicatorPanel } from '@/components/IndicatorPanel'
import { PatternOverlay } from '@/components/PatternOverlay'
import { AnalysisReport } from '@/components/AnalysisReport'

interface SearchResult { ticker: string; name: string; exchange: string }

const PERIODS = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y'] as const
type Period = typeof PERIODS[number]

interface PeriodData {
  history: any[]
  indicators: any
  patterns: any[]
}

function formatNum(n: number): string {
  if (!n || isNaN(n)) return '—'
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K'
  return n.toFixed(2)
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const searchBoxRef = useRef<HTMLDivElement>(null)
  const stockDetailsRef = useRef<HTMLDivElement>(null)
  const [portfolio, setPortfolio] = useState<any>(null)

  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [stock, setStock] = useState<any>(null)
  const [period, setPeriod] = useState<Period>('1mo')
  const [stockLoading, setStockLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<any>(null)

  // Cache all period data per ticker
  const periodCache = useRef<Record<string, Partial<Record<Period, PeriodData>>>>({})
  const [currentData, setCurrentData] = useState<PeriodData | null>(null)
  const [loadingPeriods, setLoadingPeriods] = useState<Set<Period>>(new Set())

  const [showIndicators, setShowIndicators] = useState({
    sma20: true, sma50: true, sma200: true,
    ema12: true, ema26: true, rsi: true,
    macd: true, bollingerBands: true, stochastic: true,
    volume: true,
  })

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fetch portfolio summary
  useEffect(() => {
    fetch('/api/portfolio').then(r => r.ok ? r.json() : null).then(d => { if (d?.summary) setPortfolio(d.summary) }).catch(() => {})
  }, [])

  // Debounce search
  const searchTimer = useRef<any>(null)
  const searchStocks = useCallback((v: string) => {
    setQuery(v)
    if (v.length < 1) { setResults([]); setOpen(false); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(v)}`)
        if (r.ok) {
          const raw = await r.json()
          // API returns array directly; map to SearchResult shape
          const results: SearchResult[] = (Array.isArray(raw) ? raw : raw.results || [])
            .filter((s: any) => {
              // Only show US equities/ETFs (no .XX suffixes) + SGX (.SI)
              const sym: string = (s.symbol || s.ticker || '')
              return !sym.includes('.') || sym.endsWith('.SI')
            })
            .map((s: any) => ({
              ticker: s.symbol || s.ticker,
              name: s.description || s.name || s.symbol || s.ticker,
              exchange: s.type || ''
            }))
            .slice(0, 8)
          setResults(results)
          setOpen(results.length > 0)
        }
      } catch {} finally { setSearchLoading(false) }
    }, 200)
  }, [])

  const selectStock = (ticker: string) => {
    setQuery(''); setResults([]); setOpen(false)
    setSelectedTicker(ticker.toUpperCase())
    setAnalysis(null); setPeriod('1mo'); setCurrentData(null)
  }

  const handleSubmit = (e: any) => { e.preventDefault(); if (query.trim()) selectStock(query.trim()) }

  // Fetch a single period and cache it
  const fetchPeriod = async (ticker: string, p: Period): Promise<PeriodData | null> => {
    try {
      const res = await fetch(`/api/stock/${ticker}/history?period=${p}`)
      if (!res.ok) return null
      const d = await res.json()
      const data: PeriodData = { history: d.history || [], indicators: d.indicators || null, patterns: d.patterns || [] }
      if (!periodCache.current[ticker]) periodCache.current[ticker] = {}
      periodCache.current[ticker][p] = data
      return data
    } catch { return null }
  }

  // On stock select: fetch quote + default period, then preload all others in background
  useEffect(() => {
    if (!selectedTicker) return
    let cancelled = false

    const load = async () => {
      setStockLoading(true)
      periodCache.current[selectedTicker] = {}

      // Fetch stock quote + default period in parallel
      const [sRes, defaultData] = await Promise.all([
        fetch(`/api/stock/${selectedTicker}`).then(r => r.ok ? r.json() : null).catch((e) => { console.error('Stock fetch error:', e); return null }),
        fetchPeriod(selectedTicker, '1mo'),
      ])

      if (cancelled) return
      if (sRes) setStock(sRes)
      if (defaultData) setCurrentData(defaultData)
      setStockLoading(false)

      // Smooth scroll to stock details
      setTimeout(() => {
        stockDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)

      // Auto-generate analysis in background
      setAnalyzing(true)
      fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: selectedTicker }),
      }).then(r => r.ok ? r.json() : null).then(data => {
        if (!cancelled && data) setAnalysis(data)
      }).catch(() => {}).finally(() => { if (!cancelled) setAnalyzing(false) })

      // Preload remaining periods in background
      const remaining = PERIODS.filter(p => p !== '1mo')
      setLoadingPeriods(new Set(remaining))

      await Promise.all(remaining.map(async (p) => {
        await fetchPeriod(selectedTicker, p)
        if (!cancelled) setLoadingPeriods(prev => { const next = new Set(prev); next.delete(p); return next })
      }))
    }

    load()
    return () => { cancelled = true }
  }, [selectedTicker])

  // On period switch: instant swap from cache, or fetch if not ready yet
  useEffect(() => {
    if (!selectedTicker) return

    const cached = periodCache.current[selectedTicker]?.[period]
    if (cached) {
      setCurrentData(cached)
      return
    }

    // Shouldn't happen often — fallback fetch
    let cancelled = false
    fetchPeriod(selectedTicker, period).then(data => {
      if (!cancelled && data) setCurrentData(data)
    })
    return () => { cancelled = true }
  }, [selectedTicker, period])

  const isPositive = stock ? stock.change >= 0 : true
  const isPeriodLoading = loadingPeriods.has(period) && !currentData

  return (
    <div className='min-h-screen bg-black'>
      {/* ── Hero — always the same ── */}
      <section className='relative overflow-hidden pt-20 pb-10 hero-grid'>
        <div className='glow-orb-blue' style={{ top: '-100px', left: '10%' }} />
        <div className='glow-orb-purple' style={{ top: '50px', right: '5%' }} />
        <div className='glow-orb-green' style={{ bottom: '0', left: '40%' }} />

        <div className='max-w-4xl mx-auto px-4 relative z-10'>
          <div className='text-center mb-12'>
            <div className='inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-sm text-zinc-400 mb-8'>
              <Zap size={14} className='text-yellow-400' /> AI-Powered Stock Intelligence
            </div>
            <h1 className='text-5xl md:text-7xl font-extrabold mb-5 tracking-tight'>
              <span className='text-gradient'>Finance Seer</span>
            </h1>
            <p className='text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed'>
              Real-time charts, technical indicators, pattern recognition, and AI-driven investment analysis.
            </p>

            {/* Portfolio Summary Banner */}
            {portfolio && (
              <a href='/portfolio' style={{ display: 'block', marginTop: '20px', textDecoration: 'none' }}>
                <div style={{ background: '#1a1a2e', border: '1px solid rgba(99,102,241,0.4)', borderRadius: '12px', padding: '12px 18px', cursor: 'pointer', maxWidth: '520px', margin: '20px auto 0' }}>
                  {/* Row 1: Value + Return */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Briefcase size={15} style={{ color: '#818cf8', flexShrink: 0 }} />
                      <span style={{ color: '#c7d2fe', fontSize: '13px', fontWeight: 500 }}>AI Portfolio</span>
                      <span style={{ color: '#ffffff', fontWeight: 800, fontSize: '16px' }}>${portfolio.totalValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      <span style={{ color: portfolio.totalReturn >= 0 ? '#4ade80' : '#fb7185', fontWeight: 700, fontSize: '14px' }}>
                        {portfolio.totalReturn >= 0 ? '▲' : '▼'}{Math.abs(portfolio.totalReturnPct).toFixed(2)}%
                      </span>
                    </div>
                    <span style={{ color: '#818cf8', fontSize: '12px' }}>→</span>
                  </div>
                  {/* Row 2: Details */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11px', color: '#a5b4fc', marginBottom: '5px' }}>
                    <span>Start: $100K</span>
                    <span style={{ color: '#4b5563' }}>·</span>
                    <span>{portfolio.startDate}</span>
                    <span style={{ color: '#4b5563' }}>·</span>
                    <span>Cash: ${(portfolio.cash / 1000).toFixed(1)}K</span>
                  </div>
                  {/* Row 3: Stocks with % change */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '11px' }}>
                    {portfolio.tickers?.map((t: any, i: number) => {
                      const pct = t.pctChange || 0
                      const color = pct > 0 ? '#4ade80' : pct < 0 ? '#fb7185' : '#a5b4fc'
                      return (
                        <span key={t.ticker} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <span style={{ color: '#e0e7ff', fontWeight: 600 }}>{t.ticker}</span>
                          <span style={{ color, fontWeight: 600 }}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>
                          {i < portfolio.tickers.length - 1 && <span style={{ color: '#4b5563', marginLeft: '2px' }}>·</span>}
                        </span>
                      )
                    })}
                  </div>
                </div>
              </a>
            )}
          </div>

          {/* ── SEARCH ── */}
          <div ref={searchBoxRef} style={{ width: '100%', marginTop: '64px', marginBottom: '24px', position: 'relative' }}>
            <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', background: '#0a0a0a', border: '2px solid rgba(255,255,255,0.1)', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', flex: '1 1 0%', minWidth: 0, padding: '12px 16px' }}>
                <Search size={18} className='text-zinc-500' style={{ flexShrink: 0, marginRight: '10px' }} />
                <input
                  type='text' value={query}
                  onChange={e => searchStocks(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && query.trim()) { e.preventDefault(); selectStock(query.trim()) } }}
                  onFocus={() => results.length > 0 && setOpen(true)}
                  placeholder='Search stock symbol...'
                  style={{ flex: '1 1 0%', minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'white', fontSize: '16px', padding: 0, boxShadow: 'none' }}
                  autoFocus
                />
                {searchLoading && <Loader size={16} className='animate-spin text-blue-400' style={{ flexShrink: 0, marginLeft: '8px' }} />}
              </div>
              <button onClick={handleSubmit}
                style={{ flexShrink: 0, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', color: 'white', fontSize: '14px', fontWeight: 600, padding: '10px 24px', margin: '5px', borderRadius: '8px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >Search</button>
            </div>
            {open && results.length > 0 && (
              <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: '4px', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', maxHeight: '220px', overflowY: 'auto', zIndex: 50 }}>
                {results.map((s, i) => (
                  <div key={i} onClick={() => selectStock(s.ticker)} className='hover:bg-white/5'
                    style={{ display: 'block', padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '14px' }}>
                    <span style={{ color: 'white', fontWeight: 500 }}>{s.ticker}</span>
                    <span style={{ color: '#71717a', marginLeft: '8px' }}>— {s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Stock Details ── */}
      {selectedTicker && (
        <section ref={stockDetailsRef} className='max-w-4xl mx-auto px-4 pb-16'>
          {stockLoading ? (
            <div className='flex items-center justify-center py-16'>
              <Loader className='animate-spin text-blue-400' size={36} />
              <span className='text-zinc-400 ml-4'>Loading {selectedTicker}...</span>
            </div>
          ) : !stock || !currentData ? (
            <div className='card-glass p-6'>
              <div className='flex items-start gap-3'>
                <AlertTriangle className='text-red-400 flex-shrink-0' size={20} />
                <div>
                  <p className='text-red-400'>Failed to load {selectedTicker}. Check the symbol and try again.</p>
                  <p className='text-zinc-500 text-xs mt-2'>Stock data: {stock ? '✓' : '✗'} · Chart data: {currentData ? '✓' : '✗'}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className='space-y-6'>
              {/* Header */}
              <div>
                <div className='text-zinc-500 text-xs tracking-widest mb-1'>STOCK</div>
                <h2 className='text-3xl font-extrabold text-white'>{stock.ticker}</h2>
                <p className='text-zinc-500 text-sm mt-0.5'>{stock.name} · {stock.exchange}</p>
                <div className='flex items-baseline gap-3 mt-3'>
                  <span className='text-3xl font-bold text-white'>${stock.price?.toFixed(2)}</span>
                  <span className={`px-2 py-0.5 rounded text-sm font-semibold ${isPositive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    {isPositive ? '▲' : '▼'} {Math.abs(stock.change || 0).toFixed(2)} ({Math.abs(stock.changePercent || 0).toFixed(2)}%)
                  </span>
                </div>
              </div>

              {/* Metrics Grid — 3 per row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {[
                  { label: 'Open', value: stock.open ? '$' + stock.open.toFixed(2) : '—' },
                  { label: 'Day High', value: stock.dayHigh ? '$' + stock.dayHigh.toFixed(2) : '—', color: 'text-emerald-400' },
                  { label: 'Day Low', value: stock.dayLow ? '$' + stock.dayLow.toFixed(2) : '—', color: 'text-red-400' },
                  { label: 'Volume', value: formatNum(stock.volume) },
                  { label: 'Market Cap', value: stock.marketCap ? '$' + formatNum(stock.marketCap) : '—' },
                  { label: 'P/E Ratio', value: stock.peRatio ? stock.peRatio.toFixed(2) : '—' },
                  { label: '52W High', value: stock.week52High ? '$' + stock.week52High.toFixed(2) : '—', color: 'text-emerald-400' },
                  { label: '52W Low', value: stock.week52Low ? '$' + stock.week52Low.toFixed(2) : '—', color: 'text-red-400' },
                  { label: 'Div Yield', value: stock.dividendYield ? (stock.dividendYield * 100).toFixed(2) + '%' : '—' },
                ].map((m, i) => (
                  <div key={i} style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '12px' }}>
                    <div className='text-zinc-500 text-xs mb-1'>{m.label}</div>
                    <div className={`font-bold text-base ${(m as any).color || 'text-white'}`}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <div className='space-y-3'>
                <div className='flex items-center justify-between flex-wrap gap-2'>
                  <h3 className='text-lg font-bold'>Price Action</h3>
                  <div className='flex gap-1.5 flex-wrap'>
                    {PERIODS.map((p) => {
                      const cached = !!periodCache.current[selectedTicker]?.[p]
                      const loading = loadingPeriods.has(p)
                      return (
                        <button key={p} onClick={() => setPeriod(p)}
                          className={`chip ${period === p ? 'chip-active' : 'chip-inactive'}`}
                          style={{ opacity: !cached && loading ? 0.5 : 1 }}>
                          {p.toUpperCase()}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {isPeriodLoading ? (
                  <div className='flex items-center justify-center py-8'>
                    <Loader className='animate-spin text-blue-400' size={24} />
                    <span className='text-zinc-500 ml-3 text-sm'>Loading {period.toUpperCase()}...</span>
                  </div>
                ) : currentData && currentData.history.length > 0 && currentData.indicators ? (
                  <StockChart data={currentData.history} indicators={currentData.indicators} showIndicators={showIndicators} />
                ) : null}
              </div>

              {/* Indicators */}
              <IndicatorPanel onToggle={setShowIndicators} />

              {/* Patterns */}
              {currentData && currentData.patterns.length > 0 && <PatternOverlay patterns={currentData.patterns} />}

              {/* AI Analysis */}
              {analyzing ? (
                <div className='card-glass p-6'>
                  <div className='flex items-center gap-3'>
                    <Loader className='animate-spin text-blue-400' size={18} />
                    <h3 className='text-lg font-bold text-zinc-400'>Generating AI Analysis...</h3>
                  </div>
                </div>
              ) : null}
              {analysis && <AnalysisReport report={analysis} />}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
