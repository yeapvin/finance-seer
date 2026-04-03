'use client'

import { PatternMatch } from '@/lib/patterns'
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react'

export function PatternOverlay({ patterns }: { patterns: PatternMatch[] }) {
  return (
    <div className='card-glass p-8'>
      <h3 className='text-2xl font-bold mb-6 flex items-center gap-3'>
        <AlertCircle size={24} className='text-blue-400' />
        Detected Patterns
      </h3>

      {patterns.length === 0 ? (
        <p className='text-zinc-400'>No significant patterns detected</p>
      ) : (
        <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
          {patterns.map((pattern, i) => (
            <div key={i} className='bg-[#0a0a0a] rounded-lg p-4 border border-white/10 hover:border-blue-500/30 transition-all'>
              <div className='flex items-start justify-between mb-3'>
                <div className='flex items-center gap-3'>
                  {pattern.type === 'bullish' ? (
                    <TrendingUp size={20} className='text-green-400' />
                  ) : (
                    <TrendingDown size={20} className='text-red-400' />
                  )}
                  <div>
                    <h4 className='font-semibold text-white'>{pattern.name}</h4>
                    <p className='text-xs text-zinc-400 mt-1'>
                      {pattern.type === 'bullish' ? 'Bullish' : 'Bearish'} pattern
                    </p>
                  </div>
                </div>
              </div>

              {/* Confidence bar */}
              <div className='mb-3'>
                <div className='flex items-center justify-between text-xs mb-1'>
                  <span className='text-zinc-400'>Confidence</span>
                  <span
                    className={`font-semibold ${
                      pattern.confidence >= 75
                        ? 'text-green-400'
                        : pattern.confidence >= 50
                          ? 'text-yellow-400'
                          : 'text-zinc-400'
                    }`}
                  >
                    {(pattern.confidence).toFixed(0)}%
                  </span>
                </div>
                <div className='w-full bg-[#1a1a1a]/50 rounded-full h-2'>
                  <div
                    className={`h-full rounded-full transition-all ${
                      pattern.confidence >= 75
                        ? 'bg-green-500'
                        : pattern.confidence >= 50
                          ? 'bg-yellow-500'
                          : 'bg-zinc-600'
                    }`}
                    style={{ width: `${Math.min(pattern.confidence, 100)}%` }}
                  />
                </div>
              </div>

              <p className='text-sm text-zinc-400'>{pattern.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
