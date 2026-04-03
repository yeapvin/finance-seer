export interface PatternMatch {
  name: string
  confidence: number
  description: string
  startIndex: number
  endIndex: number
  type: 'bullish' | 'bearish' | 'neutral'
}

interface PeakTrough {
  index: number
  value: number
  type: 'peak' | 'trough'
}

function findPeaksAndTroughs(prices: number[], lookback: number = 5): PeakTrough[] {
  const peaks: PeakTrough[] = []

  for (let i = lookback; i < prices.length - lookback; i++) {
    const window = prices.slice(i - lookback, i + lookback + 1)
    const maxVal = Math.max(...window)
    const minVal = Math.min(...window)

    if (prices[i] === maxVal && prices[i] !== prices[i - 1]) {
      peaks.push({ index: i, value: prices[i], type: 'peak' })
    }

    if (prices[i] === minVal && prices[i] !== prices[i - 1]) {
      peaks.push({ index: i, value: prices[i], type: 'trough' })
    }
  }

  return peaks
}

function calculateDeviation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b) / values.length
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

export function detectDoubleTop(prices: number[]): PatternMatch | null {
  const peaksAndTroughs = findPeaksAndTroughs(prices, 5)
  const peaks = peaksAndTroughs.filter((p) => p.type === 'peak')

  if (peaks.length < 2) return null

  for (let i = 1; i < peaks.length; i++) {
    const peak1 = peaks[i - 1]
    const peak2 = peaks[i]

    const tolerance = Math.max(peak1.value, peak2.value) * 0.02
    const heightDiff = Math.abs(peak1.value - peak2.value)

    if (heightDiff <= tolerance && peak2.index - peak1.index > 10) {
      const confidence = Math.max(0, 100 - heightDiff / (Math.max(peak1.value, peak2.value) * 0.1))

      return {
        name: 'Double Top',
        confidence: Math.min(confidence, 100),
        description: 'Price has formed two peaks at similar levels, suggesting potential reversal.',
        startIndex: peak1.index,
        endIndex: peak2.index,
        type: 'bearish',
      }
    }
  }

  return null
}

export function detectDoubleBottom(prices: number[]): PatternMatch | null {
  const peaksAndTroughs = findPeaksAndTroughs(prices, 5)
  const troughs = peaksAndTroughs.filter((p) => p.type === 'trough')

  if (troughs.length < 2) return null

  for (let i = 1; i < troughs.length; i++) {
    const trough1 = troughs[i - 1]
    const trough2 = troughs[i]

    const tolerance = Math.min(trough1.value, trough2.value) * 0.02
    const depthDiff = Math.abs(trough1.value - trough2.value)

    if (depthDiff <= tolerance && trough2.index - trough1.index > 10) {
      const confidence = Math.max(0, 100 - depthDiff / (Math.min(trough1.value, trough2.value) * 0.1))

      return {
        name: 'Double Bottom',
        confidence: Math.min(confidence, 100),
        description: 'Price has formed two troughs at similar levels, suggesting potential reversal.',
        startIndex: trough1.index,
        endIndex: trough2.index,
        type: 'bullish',
      }
    }
  }

  return null
}

export function detectHeadAndShoulders(prices: number[]): PatternMatch | null {
  const peaksAndTroughs = findPeaksAndTroughs(prices, 5)
  const peaks = peaksAndTroughs.filter((p) => p.type === 'peak')

  if (peaks.length < 3) return null

  for (let i = 1; i < peaks.length - 1; i++) {
    const leftShoulder = peaks[i - 1]
    const head = peaks[i]
    const rightShoulder = peaks[i + 1]

    if (
      head.value > leftShoulder.value &&
      head.value > rightShoulder.value &&
      Math.abs(leftShoulder.value - rightShoulder.value) < Math.max(leftShoulder.value, rightShoulder.value) * 0.05
    ) {
      const confidence = Math.min(100, 50 + (head.value - leftShoulder.value) / (head.value * 0.1))

      return {
        name: 'Head and Shoulders',
        confidence,
        description: 'Classic reversal pattern with a high peak (head) between two lower peaks (shoulders).',
        startIndex: leftShoulder.index,
        endIndex: rightShoulder.index,
        type: 'bearish',
      }
    }
  }

  return null
}

export function detectTriangle(prices: number[]): PatternMatch | null {
  if (prices.length < 20) return null

  const recentPrices = prices.slice(-50)
  const highs = recentPrices.map((_, i) => Math.max(...recentPrices.slice(Math.max(0, i - 5), i + 1)))
  const lows = recentPrices.map((_, i) => Math.min(...recentPrices.slice(Math.max(0, i - 5), i + 1)))

  const firstHalf = { highs: highs.slice(0, 25), lows: lows.slice(0, 25) }
  const secondHalf = { highs: highs.slice(25), lows: lows.slice(25) }

  const rangeFirst = Math.max(...firstHalf.highs) - Math.min(...firstHalf.lows)
  const rangeSecond = Math.max(...secondHalf.highs) - Math.min(...secondHalf.lows)

  if (rangeSecond < rangeFirst * 0.7 && rangeSecond > rangeFirst * 0.3) {
    const isAscending = Math.min(...secondHalf.lows) > Math.min(...firstHalf.lows)
    const isDescending = Math.max(...secondHalf.highs) < Math.max(...firstHalf.highs)

    if (isAscending || isDescending) {
      return {
        name: isAscending ? 'Ascending Triangle' : 'Descending Triangle',
        confidence: 65,
        description: isAscending
          ? 'Bullish pattern where lows increase while highs remain stable.'
          : 'Bearish pattern where highs decrease while lows remain stable.',
        startIndex: prices.length - 50,
        endIndex: prices.length - 1,
        type: isAscending ? 'bullish' : 'bearish',
      }
    }
  }

  return null
}

export function detectFlag(prices: number[]): PatternMatch | null {
  if (prices.length < 30) return null

  const recentPrices = prices.slice(-50)
  const midPoint = Math.floor(recentPrices.length / 2)

  const flagpoleRange = Math.max(...recentPrices.slice(0, midPoint)) - Math.min(...recentPrices.slice(0, midPoint))
  const consolidationRange =
    Math.max(...recentPrices.slice(midPoint)) - Math.min(...recentPrices.slice(midPoint))

  if (consolidationRange < flagpoleRange * 0.4 && flagpoleRange > 0) {
    const flagpoleDir = recentPrices[midPoint] - recentPrices[0]
    const isBullish = flagpoleDir > 0

    return {
      name: isBullish ? 'Bull Flag' : 'Bear Flag',
      confidence: 70,
      description: isBullish
        ? 'Bullish continuation pattern after strong uptrend with consolidation.'
        : 'Bearish continuation pattern after strong downtrend with consolidation.',
      startIndex: prices.length - 50,
      endIndex: prices.length - 1,
      type: isBullish ? 'bullish' : 'bearish',
    }
  }

  return null
}

export function detectCupAndHandle(prices: number[]): PatternMatch | null {
  if (prices.length < 50) return null

  const recentPrices = prices.slice(-100)
  const peaksAndTroughs = findPeaksAndTroughs(recentPrices, 5)
  const troughs = peaksAndTroughs.filter((p) => p.type === 'trough')

  if (troughs.length >= 2) {
    const minTrough = Math.min(...troughs.map((t) => t.value))
    const tolerance = minTrough * 0.02

    const cupTroughs = troughs.filter((t) => Math.abs(t.value - minTrough) <= tolerance)

    if (cupTroughs.length >= 2) {
      const cupStart = cupTroughs[0].index
      const cupEnd = cupTroughs[cupTroughs.length - 1].index
      const handlePart = recentPrices.slice(Math.max(cupEnd, cupEnd - 20))

      const handleRange = Math.max(...handlePart) - Math.min(...handlePart)
      const cupRange = Math.max(...recentPrices.slice(cupStart, cupEnd)) - minTrough

      if (handleRange < cupRange * 0.3 && cupEnd - cupStart > 15) {
        return {
          name: 'Cup and Handle',
          confidence: 75,
          description: 'Bullish continuation pattern with cup-shaped bottom and consolidation handle.',
          startIndex: prices.length - 100 + cupStart,
          endIndex: prices.length - 1,
          type: 'bullish',
        }
      }
    }
  }

  return null
}

export function findSupportResistance(
  prices: number[],
): { support: number[]; resistance: number[] } {
  if (prices.length === 0) return { support: [], resistance: [] }

  const currentPrice = prices[prices.length - 1]
  const peaksAndTroughs = findPeaksAndTroughs(prices, 5)

  // Only include levels within 20% of current price to stay relevant
  const maxDist = currentPrice * 0.20

  const support = peaksAndTroughs
    .filter((p) => p.type === 'trough' && p.value < currentPrice && currentPrice - p.value <= maxDist)
    .map((p) => p.value)
    .sort((a, b) => b - a) // closest first

  const resistance = peaksAndTroughs
    .filter((p) => p.type === 'peak' && p.value > currentPrice && p.value - currentPrice <= maxDist)
    .map((p) => p.value)
    .sort((a, b) => a - b) // closest first

  // Deduplicate nearby levels (within 1% of each other)
  const dedup = (arr: number[]) => {
    const result: number[] = []
    for (const v of arr) {
      if (!result.some(r => Math.abs(r - v) / v < 0.01)) result.push(v)
    }
    return result
  }

  return {
    support: dedup(support).slice(0, 3),
    resistance: dedup(resistance).slice(0, 3),
  }
}

export function detectPatterns(prices: number[], ohlc?: { open: number[]; high: number[]; low: number[]; close: number[] }): PatternMatch[] {
  const patterns: (PatternMatch | null)[] = [
    detectDoubleTop(prices),
    detectDoubleBottom(prices),
    detectTripleTop(prices),
    detectTripleBottom(prices),
    detectHeadAndShoulders(prices),
    detectInverseHeadAndShoulders(prices),
    detectTriangle(prices),
    detectWedge(prices),
    detectFlag(prices),
    detectChannel(prices),
    detectCupAndHandle(prices),
    detectGap(prices),
  ]

  // Candlestick patterns (require OHLC data)
  if (ohlc && ohlc.open.length > 2) {
    patterns.push(
      detectDoji(ohlc),
      detectHammer(ohlc),
      detectEngulfing(ohlc),
      detectMorningStar(ohlc),
      detectEveningStar(ohlc),
    )
  }

  return patterns.filter((p): p is PatternMatch => p !== null)
}

// ── NEW: Triple Top ──
function detectTripleTop(prices: number[]): PatternMatch | null {
  const pts = findPeaksAndTroughs(prices, 5)
  const peaks = pts.filter(p => p.type === 'peak')
  if (peaks.length < 3) return null

  for (let i = 2; i < peaks.length; i++) {
    const [p1, p2, p3] = [peaks[i-2], peaks[i-1], peaks[i]]
    const avg = (p1.value + p2.value + p3.value) / 3
    const tol = avg * 0.025
    if (Math.abs(p1.value - avg) <= tol && Math.abs(p2.value - avg) <= tol && Math.abs(p3.value - avg) <= tol
        && p3.index - p1.index > 15) {
      return {
        name: 'Triple Top', confidence: 80,
        description: 'Three peaks at similar levels indicate strong resistance. A bearish reversal is likely if price breaks below the neckline.',
        startIndex: p1.index, endIndex: p3.index, type: 'bearish',
      }
    }
  }
  return null
}

// ── NEW: Triple Bottom ──
function detectTripleBottom(prices: number[]): PatternMatch | null {
  const pts = findPeaksAndTroughs(prices, 5)
  const troughs = pts.filter(p => p.type === 'trough')
  if (troughs.length < 3) return null

  for (let i = 2; i < troughs.length; i++) {
    const [t1, t2, t3] = [troughs[i-2], troughs[i-1], troughs[i]]
    const avg = (t1.value + t2.value + t3.value) / 3
    const tol = avg * 0.025
    if (Math.abs(t1.value - avg) <= tol && Math.abs(t2.value - avg) <= tol && Math.abs(t3.value - avg) <= tol
        && t3.index - t1.index > 15) {
      return {
        name: 'Triple Bottom', confidence: 80,
        description: 'Three troughs at similar levels indicate strong support. A bullish reversal is likely if price breaks above the neckline.',
        startIndex: t1.index, endIndex: t3.index, type: 'bullish',
      }
    }
  }
  return null
}

// ── NEW: Inverse Head and Shoulders ──
function detectInverseHeadAndShoulders(prices: number[]): PatternMatch | null {
  const pts = findPeaksAndTroughs(prices, 5)
  const troughs = pts.filter(p => p.type === 'trough')
  if (troughs.length < 3) return null

  for (let i = 1; i < troughs.length - 1; i++) {
    const left = troughs[i-1], head = troughs[i], right = troughs[i+1]
    if (head.value < left.value && head.value < right.value
        && Math.abs(left.value - right.value) < Math.max(left.value, right.value) * 0.05) {
      return {
        name: 'Inverse Head & Shoulders', confidence: Math.min(100, 55 + (left.value - head.value) / (head.value * 0.1)),
        description: 'Bullish reversal pattern with a low trough (head) between two higher troughs (shoulders). Breakout above the neckline confirms the reversal.',
        startIndex: left.index, endIndex: right.index, type: 'bullish',
      }
    }
  }
  return null
}

// ── NEW: Wedge ──
function detectWedge(prices: number[]): PatternMatch | null {
  if (prices.length < 30) return null
  const recent = prices.slice(-40)
  const n = recent.length
  const half = Math.floor(n / 2)

  const firstHighs = Math.max(...recent.slice(0, half))
  const firstLows = Math.min(...recent.slice(0, half))
  const secondHighs = Math.max(...recent.slice(half))
  const secondLows = Math.min(...recent.slice(half))

  const firstRange = firstHighs - firstLows
  const secondRange = secondHighs - secondLows

  if (secondRange < firstRange * 0.65 && secondRange > firstRange * 0.2) {
    const highsTrend = secondHighs - firstHighs
    const lowsTrend = secondLows - firstLows

    // Rising wedge: both highs and lows rising, converging
    if (highsTrend > 0 && lowsTrend > 0 && lowsTrend > highsTrend) {
      return {
        name: 'Rising Wedge', confidence: 65,
        description: 'Bearish pattern where both support and resistance rise, but converge. Often precedes a downside breakout.',
        startIndex: prices.length - 40, endIndex: prices.length - 1, type: 'bearish',
      }
    }
    // Falling wedge: both falling, converging
    if (highsTrend < 0 && lowsTrend < 0 && Math.abs(lowsTrend) > Math.abs(highsTrend)) {
      return {
        name: 'Falling Wedge', confidence: 65,
        description: 'Bullish pattern where both support and resistance fall, but converge. Often precedes an upside breakout.',
        startIndex: prices.length - 40, endIndex: prices.length - 1, type: 'bullish',
      }
    }
  }
  return null
}

// ── NEW: Channel ──
function detectChannel(prices: number[]): PatternMatch | null {
  if (prices.length < 30) return null
  const recent = prices.slice(-40)
  const pts = findPeaksAndTroughs(recent, 3)
  const peaks = pts.filter(p => p.type === 'peak')
  const troughs = pts.filter(p => p.type === 'trough')

  if (peaks.length >= 2 && troughs.length >= 2) {
    const peakSlope = (peaks[peaks.length-1].value - peaks[0].value) / (peaks[peaks.length-1].index - peaks[0].index)
    const troughSlope = (troughs[troughs.length-1].value - troughs[0].value) / (troughs[troughs.length-1].index - troughs[0].index)

    // Parallel slopes = channel
    if (Math.abs(peakSlope - troughSlope) < Math.abs(peakSlope) * 0.5 + 0.01) {
      const isUp = peakSlope > 0.01
      const isDown = peakSlope < -0.01
      if (isUp || isDown) {
        return {
          name: isUp ? 'Ascending Channel' : 'Descending Channel',
          confidence: 60,
          description: isUp
            ? 'Price moves in a parallel upward channel. Potential continuation if channel holds; watch for breakout.'
            : 'Price moves in a parallel downward channel. Bearish continuation expected unless price breaks above upper channel.',
          startIndex: prices.length - 40, endIndex: prices.length - 1,
          type: isUp ? 'bullish' : 'bearish',
        }
      }
    }
  }
  return null
}

// ── NEW: Gap (Up or Down) ──
function detectGap(prices: number[]): PatternMatch | null {
  if (prices.length < 5) return null
  // Check last few bars for significant gaps
  for (let i = prices.length - 1; i >= Math.max(1, prices.length - 5); i--) {
    const prev = prices[i-1]
    const curr = prices[i]
    const gapPct = ((curr - prev) / prev) * 100

    if (Math.abs(gapPct) >= 2) {
      const isUp = gapPct > 0
      return {
        name: isUp ? 'Gap Up' : 'Gap Down',
        confidence: Math.min(90, 50 + Math.abs(gapPct) * 5),
        description: isUp
          ? `Price gapped up ${Math.abs(gapPct).toFixed(1)}% — indicates strong buying pressure. Gap may act as support.`
          : `Price gapped down ${Math.abs(gapPct).toFixed(1)}% — indicates strong selling pressure. Gap may act as resistance.`,
        startIndex: i - 1, endIndex: i,
        type: isUp ? 'bullish' : 'bearish',
      }
    }
  }
  return null
}

// ── NEW: Doji candle ──
function detectDoji(ohlc: { open: number[]; high: number[]; low: number[]; close: number[] }): PatternMatch | null {
  const n = ohlc.close.length
  for (let i = n - 1; i >= Math.max(0, n - 3); i--) {
    const o = ohlc.open[i], h = ohlc.high[i], l = ohlc.low[i], c = ohlc.close[i]
    if (!o || !h || !l || !c) continue
    const body = Math.abs(c - o)
    const range = h - l
    if (range > 0 && body / range < 0.1 && range / o > 0.005) {
      return {
        name: 'Doji', confidence: 60,
        description: 'Open and close nearly equal with significant wicks — signals indecision. Often precedes a trend reversal when appearing after a strong move.',
        startIndex: i, endIndex: i, type: 'neutral',
      }
    }
  }
  return null
}

// ── NEW: Hammer / Inverted Hammer ──
function detectHammer(ohlc: { open: number[]; high: number[]; low: number[]; close: number[] }): PatternMatch | null {
  const n = ohlc.close.length
  for (let i = n - 1; i >= Math.max(0, n - 3); i--) {
    const o = ohlc.open[i], h = ohlc.high[i], l = ohlc.low[i], c = ohlc.close[i]
    if (!o || !h || !l || !c) continue
    const body = Math.abs(c - o)
    const range = h - l
    const upperWick = h - Math.max(o, c)
    const lowerWick = Math.min(o, c) - l

    if (range > 0 && body / range < 0.35) {
      // Hammer: small body at top, long lower wick
      if (lowerWick > body * 2 && upperWick < body * 0.5) {
        return {
          name: 'Hammer', confidence: 65,
          description: 'Small body with a long lower shadow — bullish reversal signal, especially after a downtrend. Buyers stepped in to push price up.',
          startIndex: i, endIndex: i, type: 'bullish',
        }
      }
      // Inverted hammer / shooting star
      if (upperWick > body * 2 && lowerWick < body * 0.5) {
        const prevTrend = i > 2 ? ohlc.close[i] - ohlc.close[i-3] : 0
        return {
          name: prevTrend > 0 ? 'Shooting Star' : 'Inverted Hammer',
          confidence: 65,
          description: prevTrend > 0
            ? 'Small body with long upper shadow after an uptrend — bearish reversal signal. Sellers rejected higher prices.'
            : 'Small body with long upper shadow after a downtrend — potential bullish reversal if confirmed.',
          startIndex: i, endIndex: i,
          type: prevTrend > 0 ? 'bearish' : 'bullish',
        }
      }
    }
  }
  return null
}

// ── NEW: Engulfing ──
function detectEngulfing(ohlc: { open: number[]; high: number[]; low: number[]; close: number[] }): PatternMatch | null {
  const n = ohlc.close.length
  if (n < 2) return null
  for (let i = n - 1; i >= Math.max(1, n - 3); i--) {
    const pO = ohlc.open[i-1], pC = ohlc.close[i-1]
    const cO = ohlc.open[i], cC = ohlc.close[i]
    if (!pO || !pC || !cO || !cC) continue

    const prevBody = Math.abs(pC - pO)
    const currBody = Math.abs(cC - cO)

    if (currBody > prevBody * 1.5) {
      // Bullish engulfing: prev red, current green engulfs it
      if (pC < pO && cC > cO && cO <= pC && cC >= pO) {
        return {
          name: 'Bullish Engulfing', confidence: 72,
          description: 'A large green candle completely engulfs the previous red candle — strong bullish reversal signal with increased buying momentum.',
          startIndex: i-1, endIndex: i, type: 'bullish',
        }
      }
      // Bearish engulfing
      if (pC > pO && cC < cO && cO >= pC && cC <= pO) {
        return {
          name: 'Bearish Engulfing', confidence: 72,
          description: 'A large red candle completely engulfs the previous green candle — strong bearish reversal signal with increased selling pressure.',
          startIndex: i-1, endIndex: i, type: 'bearish',
        }
      }
    }
  }
  return null
}

// ── NEW: Morning Star ──
function detectMorningStar(ohlc: { open: number[]; high: number[]; low: number[]; close: number[] }): PatternMatch | null {
  const n = ohlc.close.length
  if (n < 3) return null
  for (let i = n - 1; i >= Math.max(2, n - 5); i--) {
    const o1 = ohlc.open[i-2], c1 = ohlc.close[i-2]
    const o2 = ohlc.open[i-1], c2 = ohlc.close[i-1]
    const o3 = ohlc.open[i], c3 = ohlc.close[i]
    if (!o1 || !c1 || !o2 || !c2 || !o3 || !c3) continue

    const body1 = Math.abs(c1 - o1), body2 = Math.abs(c2 - o2), body3 = Math.abs(c3 - o3)
    // First: big red, middle: small body (star), third: big green closing above midpoint of first
    if (c1 < o1 && body1 > body2 * 2 && c3 > o3 && body3 > body2 * 2 && c3 > (o1 + c1) / 2) {
      return {
        name: 'Morning Star', confidence: 75,
        description: 'Three-candle bullish reversal: large red candle, small-bodied star, then large green candle. Signals a bottom may be forming.',
        startIndex: i-2, endIndex: i, type: 'bullish',
      }
    }
  }
  return null
}

// ── NEW: Evening Star ──
function detectEveningStar(ohlc: { open: number[]; high: number[]; low: number[]; close: number[] }): PatternMatch | null {
  const n = ohlc.close.length
  if (n < 3) return null
  for (let i = n - 1; i >= Math.max(2, n - 5); i--) {
    const o1 = ohlc.open[i-2], c1 = ohlc.close[i-2]
    const o2 = ohlc.open[i-1], c2 = ohlc.close[i-1]
    const o3 = ohlc.open[i], c3 = ohlc.close[i]
    if (!o1 || !c1 || !o2 || !c2 || !o3 || !c3) continue

    const body1 = Math.abs(c1 - o1), body2 = Math.abs(c2 - o2), body3 = Math.abs(c3 - o3)
    // First: big green, middle: small body (star), third: big red closing below midpoint of first
    if (c1 > o1 && body1 > body2 * 2 && c3 < o3 && body3 > body2 * 2 && c3 < (o1 + c1) / 2) {
      return {
        name: 'Evening Star', confidence: 75,
        description: 'Three-candle bearish reversal: large green candle, small-bodied star, then large red candle. Signals a top may be forming.',
        startIndex: i-2, endIndex: i, type: 'bearish',
      }
    }
  }
  return null
}
