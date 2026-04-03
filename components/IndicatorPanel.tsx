'use client'

import { useState } from 'react'

interface IndicatorPanelProps {
  onToggle: (indicators: any) => void
}

const INDICATOR_GROUPS = {
  'Trend': ['sma20', 'sma50', 'sma200', 'ema12', 'ema26'],
  'Momentum': ['rsi', 'macd', 'stochastic'],
  'Volatility': ['bollingerBands'],
  'Volume': ['volume'],
}

export function IndicatorPanel({ onToggle }: IndicatorPanelProps) {
  const [indicators, setIndicators] = useState({
    sma20: true,
    sma50: true,
    sma200: true,
    ema12: true,
    ema26: true,
    rsi: true,
    macd: true,
    bollingerBands: true,
    stochastic: true,
    volume: true,
  })

  const handleToggle = (key: string) => {
    const updated = { ...indicators, [key]: !indicators[key as keyof typeof indicators] }
    setIndicators(updated)
    onToggle(updated)
  }

  const getIndicatorLabel = (key: string): string => {
    const labels: Record<string, string> = {
      sma20: 'SMA 20',
      sma50: 'SMA 50',
      sma200: 'SMA 200',
      ema12: 'EMA 12',
      ema26: 'EMA 26',
      rsi: 'RSI',
      macd: 'MACD',
      bollingerBands: 'Bollinger Bands',
      stochastic: 'Stochastic',
      volume: 'Volume',
    }
    return labels[key] || key
  }

  return (
    <div className='card-glass p-8'>
      <h3 className='text-2xl font-bold mb-6'>Technical Indicators</h3>

      <div className='space-y-6'>
        {Object.entries(INDICATOR_GROUPS).map(([group, keys]) => (
          <div key={group}>
            <h4 className='text-sm font-semibold text-zinc-400 uppercase mb-3 tracking-wide'>
              {group}
            </h4>
            <div className='flex flex-wrap gap-2'>
              {keys.map((key) => (
                <button
                  key={key}
                  onClick={() => handleToggle(key)}
                  className={`chip transition-all ${
                    indicators[key as keyof typeof indicators] ? 'chip-active' : 'chip-inactive'
                  }`}
                >
                  {getIndicatorLabel(key)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
