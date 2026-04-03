'use client'

import { useEffect, useRef } from 'react'
import { createChart, IChartApi, CandlestickData } from 'lightweight-charts'
import { HistoricalData } from '@/lib/yahoo'
import { IndicatorValues } from '@/lib/indicators'

interface StockChartProps {
  data: HistoricalData[]
  indicators: IndicatorValues
  showIndicators: {
    sma20: boolean
    sma50: boolean
    sma200: boolean
    ema12: boolean
    ema26: boolean
    rsi: boolean
    macd: boolean
    bollingerBands: boolean
    stochastic: boolean
    volume: boolean
  }
}

function toTime(d: any) {
  return Math.floor(new Date(d).getTime() / 1000) as any
}

function validLine(arr: number[], data: HistoricalData[]) {
  return arr
    .map((val, i) => ({ time: toTime(data[i].date), value: val }))
    .filter((d) => d.value !== null && d.value !== undefined && !isNaN(d.value))
}

export function StockChart({ data, indicators, showIndicators }: StockChartProps) {
  const priceRef = useRef<HTMLDivElement>(null)
  const volumeRef = useRef<HTMLDivElement>(null)
  const rsiRef = useRef<HTMLDivElement>(null)
  const macdRef = useRef<HTMLDivElement>(null)

  const showVolume = showIndicators.volume
  const showRSI = showIndicators.rsi || showIndicators.stochastic
  const showMACD = showIndicators.macd

  useEffect(() => {
    if (!priceRef.current || !data.length) return

    const charts: IChartApi[] = []
    const isMobile = window.innerWidth < 640
    const chartOpts = (height: number) => ({
      layout: {
        textColor: '#71717a',
        background: { type: 'solid' as const, color: '#0a0a0a' },
        fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        fontSize: isMobile ? 10 : 12,
      },
      width: priceRef.current!.clientWidth,
      height: isMobile ? Math.round(height * 0.75) : height,
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#222' },
      rightPriceScale: { visible: true, borderColor: '#222', minimumWidth: isMobile ? 50 : 65 },
      crosshair: { mode: 1 as const, vertLine: { color: '#333' }, horzLine: { color: '#333' } },
      grid: { vertLines: { color: '#111' }, horzLines: { color: '#111' } },
      handleScroll: false,
      handleScale: false,
    })

    // ── Price Chart ──
    const priceChart = createChart(priceRef.current, chartOpts(420))
    charts.push(priceChart)

    const candleData: CandlestickData[] = data.map((d) => ({
      time: toTime(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }))

    const candleSeries = priceChart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
    })
    candleSeries.setData(candleData)

    // Volume
    const volumeSeries = priceChart.addHistogramSeries({
      color: '#3b82f6',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    priceChart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    })
    volumeSeries.setData(
      data.map((d) => ({
        time: toTime(d.date),
        value: d.volume,
        color: d.close >= d.open ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
      }))
    )

    // SMA 20
    if (showIndicators.sma20 && indicators.sma20) {
      const s = priceChart.addLineSeries({ color: '#f59e0b', lineWidth: 1 })
      s.setData(validLine(indicators.sma20, data))
    }
    // SMA 50
    if (showIndicators.sma50 && indicators.sma50) {
      const s = priceChart.addLineSeries({ color: '#8b5cf6', lineWidth: 1 })
      s.setData(validLine(indicators.sma50, data))
    }
    // SMA 200
    if (showIndicators.sma200 && indicators.sma200) {
      const s = priceChart.addLineSeries({ color: '#ec4899', lineWidth: 1 })
      s.setData(validLine(indicators.sma200, data))
    }
    // EMA 12
    if (showIndicators.ema12 && indicators.ema12) {
      const s = priceChart.addLineSeries({ color: '#06b6d4', lineWidth: 1 })
      s.setData(validLine(indicators.ema12, data))
    }
    // EMA 26
    if (showIndicators.ema26 && indicators.ema26) {
      const s = priceChart.addLineSeries({ color: '#14b8a6', lineWidth: 1 })
      s.setData(validLine(indicators.ema26, data))
    }
    // Bollinger Bands
    if (showIndicators.bollingerBands && indicators.bollingerBands) {
      const upper = priceChart.addLineSeries({ color: 'rgba(99,102,241,0.5)', lineWidth: 1, lineStyle: 2 })
      const middle = priceChart.addLineSeries({ color: 'rgba(99,102,241,0.3)', lineWidth: 1 })
      const lower = priceChart.addLineSeries({ color: 'rgba(99,102,241,0.5)', lineWidth: 1, lineStyle: 2 })
      upper.setData(
        indicators.bollingerBands
          .map((b, i) => ({ time: toTime(data[i].date), value: b.upper }))
          .filter((d) => !isNaN(d.value) && d.value !== null)
      )
      middle.setData(
        indicators.bollingerBands
          .map((b, i) => ({ time: toTime(data[i].date), value: b.middle }))
          .filter((d) => !isNaN(d.value) && d.value !== null)
      )
      lower.setData(
        indicators.bollingerBands
          .map((b, i) => ({ time: toTime(data[i].date), value: b.lower }))
          .filter((d) => !isNaN(d.value) && d.value !== null)
      )
    }

    priceChart.timeScale().fitContent()

    // ── Volume Chart ──
    if (showVolume && volumeRef.current) {
      const volChart = createChart(volumeRef.current, chartOpts(120))
      charts.push(volChart)

      const volSeries = volChart.addHistogramSeries({
        color: '#3b82f6',
        priceFormat: { type: 'volume' },
      })
      volSeries.setData(
        data.map((d) => ({
          time: toTime(d.date),
          value: d.volume,
          color: d.close >= d.open ? 'rgba(16,185,129,0.6)' : 'rgba(239,68,68,0.6)',
        }))
      )

      // Add volume moving average (20-period)
      if (data.length > 20) {
        const volMA: { time: any; value: number }[] = []
        for (let i = 19; i < data.length; i++) {
          let sum = 0
          for (let j = i - 19; j <= i; j++) sum += data[j].volume
          volMA.push({ time: toTime(data[i].date), value: sum / 20 })
        }
        const maLine = volChart.addLineSeries({ color: '#f59e0b', lineWidth: 1.5 })
        maLine.setData(volMA)
      }

      volChart.timeScale().fitContent()
    }

    // ── RSI / Stochastic Chart ──
    if (showRSI && rsiRef.current) {
      const rsiChart = createChart(rsiRef.current, chartOpts(150))
      charts.push(rsiChart)

      if (showIndicators.rsi && indicators.rsi) {
        const rsiLine = rsiChart.addLineSeries({ color: '#f59e0b', lineWidth: 2 })
        rsiLine.setData(validLine(indicators.rsi, data))

        // Overbought/oversold reference lines
        const ob = rsiChart.addLineSeries({ color: 'rgba(239,68,68,0.3)', lineWidth: 1, lineStyle: 2 })
        const os = rsiChart.addLineSeries({ color: 'rgba(16,185,129,0.3)', lineWidth: 1, lineStyle: 2 })
        const times = data.map(d => toTime(d.date))
        ob.setData(times.map(t => ({ time: t, value: 70 })))
        os.setData(times.map(t => ({ time: t, value: 30 })))
      }

      if (showIndicators.stochastic && indicators.stochastic) {
        const kLine = rsiChart.addLineSeries({ color: '#06b6d4', lineWidth: 1 })
        const dLine = rsiChart.addLineSeries({ color: '#f472b6', lineWidth: 1 })
        kLine.setData(
          indicators.stochastic
            .map((s, i) => ({ time: toTime(data[i].date), value: s.k }))
            .filter((d) => d.value !== null && !isNaN(d.value))
        )
        dLine.setData(
          indicators.stochastic
            .map((s, i) => ({ time: toTime(data[i].date), value: s.d }))
            .filter((d) => d.value !== null && !isNaN(d.value))
        )
      }

      rsiChart.timeScale().fitContent()
    }

    // ── MACD Chart ──
    if (showMACD && macdRef.current && indicators.macd) {
      const macdChart = createChart(macdRef.current, chartOpts(150))
      charts.push(macdChart)

      // MACD line
      const macdLine = macdChart.addLineSeries({ color: '#3b82f6', lineWidth: 2 })
      macdLine.setData(validLine(indicators.macd, data))

      // Signal line
      if (indicators.macdSignal) {
        // The API returns 'signal' key
        const sigKey = (indicators as any).signal || indicators.macdSignal
        const sigLine = macdChart.addLineSeries({ color: '#ef4444', lineWidth: 1 })
        sigLine.setData(validLine(sigKey, data))
      }

      // Histogram
      const histKey = (indicators as any).histogram || indicators.macdHistogram
      if (histKey) {
        const hist = macdChart.addHistogramSeries({ color: '#10b981' })
        hist.setData(
          histKey
            .map((v: number, i: number) => ({
              time: toTime(data[i].date),
              value: v,
              color: v >= 0 ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)',
            }))
            .filter((d: any) => d.value !== null && !isNaN(d.value))
        )
      }

      macdChart.timeScale().fitContent()
    }

    const handleResize = () => {
      if (priceRef.current) {
        charts.forEach(c => c.applyOptions({ width: priceRef.current!.clientWidth }))
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      charts.forEach(c => c.remove())
    }
  }, [data, indicators, showIndicators, showVolume, showRSI, showMACD])

  return (
    <div className='space-y-1'>
      <div ref={priceRef} className='w-full card-glass overflow-hidden' style={{ minHeight: '420px' }} />
      {showVolume && (
        <div>
          <div className='text-xs text-zinc-500 px-2 py-1 font-medium'>Volume · <span className='text-yellow-500'>MA(20)</span></div>
          <div ref={volumeRef} className='w-full card-glass overflow-hidden' style={{ minHeight: '120px' }} />
        </div>
      )}
      {showRSI && (
        <div>
          <div className='text-xs text-zinc-500 px-2 py-1 font-medium'>
            {showIndicators.rsi && 'RSI'}{showIndicators.rsi && showIndicators.stochastic && ' · '}{showIndicators.stochastic && 'Stochastic'}
          </div>
          <div ref={rsiRef} className='w-full card-glass overflow-hidden' style={{ minHeight: '150px' }} />
        </div>
      )}
      {showMACD && (
        <div>
          <div className='text-xs text-zinc-500 px-2 py-1 font-medium'>MACD</div>
          <div ref={macdRef} className='w-full card-glass overflow-hidden' style={{ minHeight: '150px' }} />
        </div>
      )}
    </div>
  )
}
