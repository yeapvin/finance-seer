export interface IndicatorValues {
  sma20: number[]
  sma50: number[]
  sma200: number[]
  ema12: number[]
  ema26: number[]
  rsi: number[]
  macd: number[]
  macdSignal: number[]
  macdHistogram: number[]
  bollingerBands: Array<{ upper: number; middle: number; lower: number }>
  stochastic: Array<{ k: number; d: number }>
}

export function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = []
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(NaN)
    } else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
      sma.push(sum / period)
    }
  }
  return sma
}

export function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = []
  const k = 2 / (period + 1)

  let sma = 0
  for (let i = 0; i < period && i < prices.length; i++) {
    sma += prices[i]
  }
  sma /= period

  for (let i = 0; i < prices.length; i++) {
    if (i === 0) {
      ema.push(NaN)
    } else if (i < period) {
      ema.push(NaN)
    } else if (i === period) {
      ema.push(sma)
    } else {
      const prevEMA = ema[i - 1]
      const value = (prices[i] - prevEMA) * k + prevEMA
      ema.push(value)
    }
  }

  return ema
}

export function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = []
  const changes: number[] = []

  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1])
  }

  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      rsi.push(NaN)
    } else {
      const gains = changes.slice(i - period, i).filter((c) => c > 0).reduce((a, b) => a + b, 0)
      const losses = changes.slice(i - period, i).filter((c) => c < 0).reduce((a, b) => a + Math.abs(b), 0)

      const avgGain = gains / period
      const avgLoss = losses / period

      if (avgLoss === 0) {
        rsi.push(100)
      } else {
        const rs = avgGain / avgLoss
        const value = 100 - 100 / (1 + rs)
        rsi.push(value)
      }
    }
  }

  return rsi
}

export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): { macd: number[]; signal: number[]; histogram: number[] } {
  const ema12 = calculateEMA(prices, fastPeriod)
  const ema26 = calculateEMA(prices, slowPeriod)

  const macd: number[] = []
  for (let i = 0; i < prices.length; i++) {
    if (isNaN(ema12[i]) || isNaN(ema26[i])) {
      macd.push(NaN)
    } else {
      macd.push(ema12[i] - ema26[i])
    }
  }

  const signal = calculateEMA(macd.filter((v) => !isNaN(v)), signalPeriod)
  const paddedSignal: number[] = Array(macd.length).fill(NaN)
  let signalIndex = 0
  for (let i = 0; i < macd.length; i++) {
    if (!isNaN(macd[i])) {
      if (signalIndex < signal.length) {
        paddedSignal[i] = signal[signalIndex++]
      }
    }
  }

  const histogram: number[] = []
  for (let i = 0; i < prices.length; i++) {
    if (isNaN(macd[i]) || isNaN(paddedSignal[i])) {
      histogram.push(NaN)
    } else {
      histogram.push(macd[i] - paddedSignal[i])
    }
  }

  return { macd, signal: paddedSignal, histogram }
}

export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDevs: number = 2,
): Array<{ upper: number; middle: number; lower: number }> {
  const sma = calculateSMA(prices, period)
  const bands: Array<{ upper: number; middle: number; lower: number }> = []

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1 || isNaN(sma[i])) {
      bands.push({ upper: NaN, middle: NaN, lower: NaN })
    } else {
      const slice = prices.slice(i - period + 1, i + 1)
      const mean = slice.reduce((a, b) => a + b) / period
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period
      const stdDev = Math.sqrt(variance)

      bands.push({
        middle: mean,
        upper: mean + stdDevs * stdDev,
        lower: mean - stdDevs * stdDev,
      })
    }
  }

  return bands
}

export function calculateStochastic(
  high: number[],
  low: number[],
  close: number[],
  period: number = 14,
  smoothK: number = 3,
  smoothD: number = 3,
): Array<{ k: number; d: number }> {
  const fastK: number[] = []

  for (let i = 0; i < close.length; i++) {
    if (i < period - 1) {
      fastK.push(NaN)
    } else {
      const slice = { h: high.slice(i - period + 1, i + 1), l: low.slice(i - period + 1, i + 1) }
      const lowestLow = Math.min(...slice.l)
      const highestHigh = Math.max(...slice.h)

      if (highestHigh === lowestLow) {
        fastK.push(50)
      } else {
        const k = ((close[i] - lowestLow) / (highestHigh - lowestLow)) * 100
        fastK.push(k)
      }
    }
  }

  const k = calculateSMA(fastK.filter((v) => !isNaN(v)), smoothK)
  const d = calculateSMA(k.filter((v) => !isNaN(v)), smoothD)

  const result: Array<{ k: number; d: number }> = []
  let kIndex = 0
  let dIndex = 0

  for (let i = 0; i < close.length; i++) {
    if (isNaN(fastK[i])) {
      result.push({ k: NaN, d: NaN })
    } else {
      result.push({
        k: !isNaN(k[kIndex]) ? k[kIndex] : NaN,
        d: !isNaN(d[dIndex]) ? d[dIndex] : NaN,
      })
      kIndex++
      dIndex++
    }
  }

  return result
}

export function calculateAllIndicators(
  prices: number[],
  highs: number[],
  lows: number[],
): IndicatorValues {
  return {
    sma20: calculateSMA(prices, 20),
    sma50: calculateSMA(prices, 50),
    sma200: calculateSMA(prices, 200),
    ema12: calculateEMA(prices, 12),
    ema26: calculateEMA(prices, 26),
    rsi: calculateRSI(prices, 14),
    ...(() => { const m = calculateMACD(prices); return { macd: m.macd, macdSignal: m.signal, macdHistogram: m.histogram } })(),
    bollingerBands: calculateBollingerBands(prices, 20, 2),
    stochastic: calculateStochastic(highs, lows, prices, 14, 3, 3),
  }
}
