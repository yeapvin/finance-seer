#!/usr/bin/env python3
"""
Finance Seer Local Monitor — runs every 10 min during NYSE hours
1. Sync portfolio from IBKR
2. Check SL/TP on open positions
3. Scan market for buy opportunities
4. Send Telegram alerts for trades (3-min approval window)
5. Execute approved trades via IBKR
6. Push updated portfolio to KV + GitHub
"""
import json, sys, time, subprocess, urllib.request, urllib.parse
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
IBKR_HOST    = '172.23.160.1'
IBKR_PORT    = 4002
IBKR_ACCOUNT = 'DU7992310'
PORTFOLIO    = Path(__file__).parent.parent / 'data' / 'portfolio.json'
SCRIPTS      = Path(__file__).parent
IBKR_CLI     = SCRIPTS / 'ibkr_execute.py'  # uses limit orders + commission tracking
SYNC_SCRIPT  = SCRIPTS / 'sync_from_ibkr.py'
KV_URL       = 'https://clean-eagle-92052.upstash.io'
KV_TOKEN     = 'gQAAAAAAAWeUAAIncDFiZmRiYzc1NDY1YjI0NjU3YTYwMzc4Y2Y4ZTIxZWUzNHAxOTIwNTI'
TG_TOKEN     = '8609316971:AAFhvA7fOyXRx5ch5Mm740ajcjMRD5brIr4'
TG_CHAT      = '786437034'
FINANCE_SEER = 'https://finance-seer.vercel.app'

# NYSE market hours (all UTC)
NYSE_OPEN_UTC  = (13, 30)  # 13:30 UTC
NYSE_CLOSE_UTC = (20,  0)  # 20:00 UTC

MAX_POSITIONS    = 8
MIN_CASH_RESERVE = 0.15  # 15% cash reserve
MAX_POSITION_PCT = 0.15  # 15% max per position


# ── Helpers ───────────────────────────────────────────────────────────────────
def log(msg): print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def kv_set(data: dict):
    req = urllib.request.Request(f'{KV_URL}/set/portfolio',
        data=json.dumps(data).encode(),
        headers={'Authorization': f'Bearer {KV_TOKEN}', 'Content-Type': 'application/json'},
        method='POST')
    urllib.request.urlopen(req, timeout=10)

def send_telegram(msg: str, buttons=None) -> int | None:
    try:
        body: dict = {'chat_id': TG_CHAT, 'text': msg, 'parse_mode': 'Markdown'}
        if buttons:
            body['reply_markup'] = {'inline_keyboard': buttons}
        data = json.dumps(body).encode()
        req = urllib.request.Request(f'https://api.telegram.org/bot{TG_TOKEN}/sendMessage',
            data=data, headers={'Content-Type': 'application/json'})
        resp = json.loads(urllib.request.urlopen(req, timeout=10).read())
        return resp.get('result', {}).get('message_id')
    except Exception as e:
        log(f'Telegram send failed: {e}')
        return None

def get_recent_messages(since_ts: float) -> list[str]:
    """Poll Telegram for recent messages since timestamp"""
    try:
        url = f'https://api.telegram.org/bot{TG_TOKEN}/getUpdates?timeout=1&allowed_updates=["message","callback_query"]'
        resp = json.loads(urllib.request.urlopen(url, timeout=5).read())
        messages = []
        for update in resp.get('result', []):
            msg = update.get('message', {})
            cb  = update.get('callback_query', {})
            ts  = msg.get('date', 0) or cb.get('message', {}).get('date', 0)
            if ts >= since_ts:
                text = msg.get('text', '') or cb.get('data', '')
                if text:
                    messages.append(text.upper())
        return messages
    except:
        return []

def ibkr_trade(action: str, ticker: str, shares: int, price: float) -> dict:
    """Execute limit order via IBKR. price is required (no market orders)."""
    if not price or price <= 0:
        return {'error': 'Price required for limit orders'}
    args = [sys.executable, str(IBKR_CLI), action, ticker, str(shares), str(round(price, 2))]
    result = subprocess.run(args, capture_output=True, text=True, timeout=60)
    try:
        return json.loads(result.stdout)
    except:
        return {'error': result.stderr or result.stdout or 'Unknown'}

def get_live_price(ticker: str) -> float | None:
    """Get live price from IBKR"""
    try:
        from ib_insync import IB, Stock
        ib = IB()
        ib.connect(IBKR_HOST, IBKR_PORT, clientId=35, timeout=10)
        contract = Stock(ticker, 'SMART', 'USD')
        ib.qualifyContracts(contract)
        ticker_data = ib.reqMktData(contract, '', False, False)
        ib.sleep(2)
        price = ticker_data.last or ticker_data.close or None
        ib.cancelMktData(contract)
        ib.disconnect()
        return float(price) if price else None
    except:
        return None

def push_portfolio(p: dict):
    """Save to local file, KV, and git"""
    with open(PORTFOLIO, 'w') as f:
        json.dump(p, f, indent=2)
    kv_set(p)
    try:
        repo = str(PORTFOLIO.parent.parent)
        subprocess.run(['git', 'add', '-f', 'data/portfolio.json'], cwd=repo, capture_output=True)
        subprocess.run(['git', 'commit', '-m', 'Portfolio update via local monitor'], cwd=repo, capture_output=True)
        subprocess.run(['git', 'push', 'origin', 'master'], cwd=repo, capture_output=True)
    except:
        pass

def propose_trade(action: str, ticker: str, shares: int, price: float, sl: float, tp: float, reason: str, rsi: float = 0, volume: int = 0):
    """Send trade proposal via Telegram — execution handled by main OpenClaw session."""
    import subprocess
    script = str(Path(__file__).parent / 'propose_trade.py')
    subprocess.run([sys.executable, script, action, ticker, str(shares),
                    str(price), str(sl), str(tp), reason[:120],
                    str(round(rsi, 1)), str(int(volume))],
                   capture_output=True, timeout=15)

# ── Local Screener (IBKR-native) ───────────────────────────────────────────────
def calc_rsi(closes: list, period=14) -> float:
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i-1]
        gains.append(max(d,0)); losses.append(max(-d,0))
    if len(gains) < period: return 50.0
    ag = sum(gains[-period:]) / period
    al = sum(losses[-period:]) / period
    return 100 - (100 / (1 + ag/al)) if al > 0 else 100.0

def calc_sma(closes: list, period: int) -> float:
    return sum(closes[-period:]) / period if len(closes) >= period else 0.0

def calc_atr(bars: list, period=14) -> float:
    trs = [max(b.high-b.low, abs(b.high-bars[i-1].close), abs(b.low-bars[i-1].close))
           for i,b in enumerate(bars) if i > 0]
    return sum(trs[-period:]) / period if len(trs) >= period else 0.0

def get_ibkr_technicals(ib, ticker: str) -> dict | None:
    """Get live quote + historical indicators from IBKR"""
    try:
        from ib_insync import Stock
        contract = Stock(ticker, 'SMART', 'USD')
        ib.qualifyContracts(contract)
        # Historical bars for indicators
        bars = ib.reqHistoricalData(contract, endDateTime='', durationStr='6 M',
            barSizeSetting='1 day', whatToShow='ADJUSTED_LAST', useRTH=True)
        if not bars or len(bars) < 30:
            return None
        closes = [b.close for b in bars]
        price  = closes[-1]
        rsi_val  = calc_rsi(closes)
        sma50    = calc_sma(closes, 50)
        sma200   = calc_sma(closes, 200)
        atr      = calc_atr(bars)
        # Simple MACD: EMA12 - EMA26
        def ema(data, p):
            k = 2/(p+1); e = data[0]
            for v in data[1:]: e = v*k + e*(1-k)
            return e
        macd     = ema(closes, 12) - ema(closes, 26)
        macd_sig = ema([ema(closes[:i+1], 12) - ema(closes[:i+1], 26) for i in range(len(closes))], 9)
        return {
            'price':    price,
            'rsi':      rsi_val,
            'sma50':    sma50,
            'sma200':   sma200,
            'atr':      atr,
            'macd':     macd,
            'macd_sig': macd_sig,
        }
    except:
        return None

def tv_bulk_screen(held: list) -> list:
    """Fast bulk screen using tvscreener — returns pre-filtered tickers with indicators."""
    try:
        from tvscreener import StockScreener, StockField, Market, FilterOperator
        import math

        def clean(v):
            try: return None if math.isnan(float(v)) else float(v)
            except: return None

        sc = StockScreener()
        sc.set_markets(Market.AMERICA)
        # Filters: price $25+, volume 2M+, market cap $2B+
        sc.add_filter(StockField.PRICE, FilterOperator.ABOVE, 25)
        sc.add_filter(StockField.VOLUME, FilterOperator.ABOVE, 2000000)
        sc.add_filter(StockField.MARKET_CAPITALIZATION, FilterOperator.ABOVE, 2e9)
        df = sc.get()
        if df.empty:
            return []

        results = []
        for _, row in df.iterrows():
            sym = str(row.get('Name', '')).strip()
            if not sym or sym in held or not sym.isalpha() or len(sym) > 5:
                continue

            price  = clean(row.get('Price'))
            rsi    = clean(row.get('Relative Strength Index (14)'))
            sma50  = clean(row.get('Simple Moving Average (50)'))
            sma200 = clean(row.get('Simple Moving Average (200)'))
            macd   = clean(row.get('MACD Level (12, 26)'))
            macd_s = clean(row.get('MACD Signal (12, 26)'))
            atr    = clean(row.get('Average True Range (14)'))
            volume = clean(row.get('Volume')) or 0

            if not price or not rsi or not sma200 or not atr:
                continue

            # Filters
            above_sma200 = price > sma200
            above_sma50  = sma50 and price > sma50
            oversold     = rsi < 40
            if not above_sma200 and not oversold: continue
            if rsi > 75: continue

            # Confidence
            bullish = sum([
                above_sma200, above_sma50 or False, oversold,
                rsi > 50, (macd or 0) > (macd_s or 0),
            ])
            if bullish < 2: continue
            confidence = 'HIGH' if bullish >= 4 else 'MEDIUM'

            # SL/TP
            sl = round(max(price - atr * 1.5, price * 0.92), 2)
            tp = round(min(price + atr * 3.0, price * 1.15), 2)
            risk = price - sl; reward = tp - price
            rr = round(reward / risk, 1) if risk > 0 else 0
            if rr < 2.0: continue

            results.append({'ticker': sym, 'price': price, 'rsi': rsi,
                             'sl': sl, 'tp': tp, 'rr': rr, 'atr': atr,
                             'volume': int(volume), 'confidence': confidence,
                             'above_sma200': above_sma200, 'above_sma50': above_sma50 or False,
                             'oversold': oversold, 'bullish': bullish,
                             'macd_bullish': (macd or 0) > (macd_s or 0)})

        results.sort(key=lambda x: x['rr'], reverse=True)
        return results
    except Exception as e:
        log(f'tvscreener error: {e}')
        return []

def local_screen(portfolio: dict, cash_usd: float, total_usd: float) -> list:
    """Screen 100+ stocks via tvscreener bulk, confirm top pick with IBKR"""
    held = [p['ticker'] for p in portfolio.get('positions', [])]

    log('  Running tvscreener bulk scan (100+ stocks)...')
    tv_results = tv_bulk_screen(held)
    log(f'  tvscreener: {len(tv_results)} candidates pass filters')

    if not tv_results:
        return []

    candidates = []
    # Take top 5 by R/R and confirm with IBKR for price accuracy
    try:
        from ib_insync import IB
        ib = IB()
        ib.connect(IBKR_HOST, IBKR_PORT, clientId=30, timeout=15)

        for r in tv_results[:5]:
            ticker = r['ticker']
            # Get precise price + ATR from IBKR historical data
            tech = get_ibkr_technicals(ib, ticker)
            price = tech['price'] if tech else r['price']
            atr   = tech['atr']   if tech else r['atr']
            if not price or price != price: continue

            sl = round(max(price - atr * 1.5, price * 0.92), 2)
            tp = round(min(price + atr * 3.0, price * 1.15), 2)
            risk = price - sl; reward = tp - price
            rr = round(reward / risk, 1) if risk > 0 else 0
            if rr < 2.0: continue

            rsi = r['rsi']
            confidence = r['confidence']
            bullish = r['bullish']
            oversold = r['oversold']
            above_sma200 = r['above_sma200']
            above_sma50  = r['above_sma50']

            reason = (f'[{confidence}] {bullish}/5 signals. RSI {rsi:.0f}'
                      f'{" (oversold)" if oversold else ""}'
                      f'. {"Above SMA50+200" if above_sma50 and above_sma200 else "Above SMA200" if above_sma200 else ""}'
                      f'. R/R 1:{rr}.')

            candidates.append({'type':'BUY','ticker':ticker,'price':price,
                                'sl':sl,'tp':tp,'reason':reason,'rr':rr,
                                'rsi':rsi,'volume':r['volume'],'confidence':confidence})
            log(f'  ✅ {ticker} @ ${price:.2f} | RSI {rsi:.0f} | {confidence} | R/R 1:{rr}')

        ib.disconnect()
    except Exception as e:
        log(f'IBKR confirmation error: {e}')
        # Fall back to tvscreener prices if IBKR fails
        for r in tv_results[:3]:
            rsi = r['rsi']; price = r['price']; sl = r['sl']; tp = r['tp']; rr = r['rr']
            confidence = r['confidence']; bullish = r['bullish']
            reason = f'[{confidence}] {bullish}/5 signals. RSI {rsi:.0f}. R/R 1:{rr}.'
            candidates.append({'type':'BUY','ticker':r['ticker'],'price':price,
                                'sl':sl,'tp':tp,'reason':reason,'rr':rr,
                                'rsi':rsi,'volume':r['volume'],'confidence':confidence})

    candidates.sort(key=lambda x: x['rr'], reverse=True)
    return candidates[:1]  # Best candidate only


# ── Main ──────────────────────────────────────────────────────────────────────
def is_market_open() -> bool:
    """Check if NYSE is open based on UTC time."""
    now = datetime.now(timezone.utc)
    dow = now.weekday()  # 0=Mon, 6=Sun
    if dow >= 5:  # Saturday or Sunday
        return False
    h, m = now.hour, now.minute
    open_mins  = NYSE_OPEN_UTC[0]  * 60 + NYSE_OPEN_UTC[1]
    close_mins = NYSE_CLOSE_UTC[0] * 60 + NYSE_CLOSE_UTC[1]
    current_mins = h * 60 + m
    return open_mins <= current_mins < close_mins

def process_pending_trades(p: dict) -> bool:
    """Auto-execute pending trades older than 30 seconds. Returns True if any executed."""
    pending = p.get('pendingTrades', {})
    if not pending:
        return False

    executed_any = False
    now = datetime.now(timezone.utc).timestamp()

    for trade_id, trade in list(pending.items()):
        if trade.get('status') != 'pending':
            continue

        created = trade.get('createdAt', '')
        # Proposal was sent by previous heartbeat run.
        # This heartbeat fires ~5 min later — that's the natural decision window.

        action = trade['action']
        ticker = trade['ticker']
        shares = trade['shares']
        price  = trade['price']
        sl     = trade.get('sl', round(price * 0.92, 2))
        tp     = trade.get('tp', round(price * 1.15, 2))
        reason = trade.get('reason', '')

        log(f'Auto-executing {action} {shares}x {ticker} @ ${price:.2f} (age: {age_secs:.0f}s)')
        p['pendingTrades'][trade_id]['status'] = 'executing'

        result = subprocess.run(
            [sys.executable, str(SCRIPTS / 'ibkr_execute.py'), action, ticker, str(shares), str(price)],
            capture_output=True, text=True, timeout=60
        )
        try:
            ibkr = json.loads(result.stdout)
        except:
            log(f'  IBKR error: {result.stderr}')
            p['pendingTrades'][trade_id]['status'] = 'failed'
            continue

        if ibkr.get('error'):
            log(f'  IBKR error: {ibkr["error"]}')
            p['pendingTrades'][trade_id]['status'] = 'failed'
            send_telegram(f'⚠️ IBKR error on {action} {ticker}: {ibkr["error"]}')
            continue

        filled   = ibkr.get('filled', 0)
        avg_fill = ibkr.get('avgFillPrice', price)
        commission = ibkr.get('commission', 0)

        # Record trade
        subprocess.run(
            [sys.executable, str(SCRIPTS / 'record_trade.py'),
             action, ticker, str(int(filled)), str(price), str(avg_fill), str(commission)],
            capture_output=True, timeout=30
        )

        p['pendingTrades'][trade_id]['status'] = 'executed'
        executed_any = True

        emoji = '🟢' if action == 'BUY' else '🔴'
        cost_k = (avg_fill * shares) / 1000
        send_telegram(
            f'{emoji} *Auto-executed: {action} {int(filled)}x {ticker}* @ ${avg_fill:.2f}\n'
            f'Cost: ~${cost_k:.1f}K | SL ${sl:.2f} | TP ${tp:.2f}\n'
            f'Commission: ${commission:.4f}'
        )
        log(f'  Executed: {int(filled)}x {ticker} @ ${avg_fill:.2f}')

    return executed_any


def main():
    log('Starting monitor run')

    # Always check for pending trades first (regardless of market hours)
    try:
        with open(PORTFOLIO) as f:
            p_check = json.load(f)
        if process_pending_trades(p_check):
            push_portfolio(p_check)
    except Exception as e:
        log(f'Pending trade check error: {e}')

    # Guard: only run during NYSE hours (UTC)
    if not is_market_open():
        log('Market closed (UTC check) — skipping')
        return

    # 1. Sync from IBKR
    log('Syncing from IBKR...')
    result = subprocess.run([sys.executable, str(SYNC_SCRIPT)], capture_output=True, text=True, timeout=60)
    try:
        sync = json.loads(result.stdout)
        log(f"Synced: NLV ${sync.get('nlv_usd',0):,.0f}, positions: {sync.get('positions',0)}")
    except:
        log(f'Sync warning: {result.stderr or result.stdout}')

    with open(PORTFOLIO) as f:
        p = json.load(f)

    positions = p.get('positions', [])
    cash_usd  = p['cashByValue'].get('USD', 0)
    total_usd = cash_usd + sum((pos.get('currentPrice') or pos.get('buyPrice') or 0) * pos['shares'] for pos in positions)

    # 2. Check SL/TP on open positions
    for pos in list(positions):
        price = get_live_price(pos['ticker'])
        if not price:
            continue

        # Update current price
        idx = next((i for i,x in enumerate(p['positions']) if x['ticker']==pos['ticker']), -1)
        if idx >= 0:
            p['positions'][idx]['currentPrice'] = price

        sl = pos.get('stopLoss')
        tp = pos.get('takeProfit')
        trigger = None
        reason  = ''

        if sl and price <= sl:
            trigger = 'SELL'
            reason  = f'Stop-loss hit at ${price:.2f} (SL: ${sl:.2f})'
        elif tp and price >= tp:
            trigger = 'SELL'
            reason  = f'Take-profit hit at ${price:.2f} (TP: ${tp:.2f})'

        if trigger:
            shares = pos['shares']
            pnl = (price - pos['buyPrice']) * shares
            full_reason = f"{reason} P&L if sold: {'+' if pnl>=0 else ''}${pnl:.0f}"
            propose_trade('SELL', pos['ticker'], shares, price,
                          pos.get('stopLoss', round(price*0.95,2)),
                          pos.get('takeProfit', round(price*1.08,2)),
                          full_reason)
            log(f'SL/TP signal proposed: SELL {shares}x {pos["ticker"]} @ ${price:.2f}')

    # 3. Scan for buy opportunities
    n_positions = len(p['positions'])
    if n_positions >= MAX_POSITIONS:
        log(f'Max positions ({MAX_POSITIONS}) reached, skipping buy scan')
        return

    min_cash   = total_usd * MIN_CASH_RESERVE
    deployable = cash_usd - min_cash
    if deployable < 5000:
        log(f'Insufficient deployable cash (${deployable:.0f}), skipping buy scan')
        return

    # Local screener using tvscreener + Groq LLM
    log('Scanning market locally via tvscreener...')
    candidates = local_screen(p, cash_usd, total_usd)
    log(f'Local screener found {len(candidates)} candidates')

    buys_done = 0
    for trade in candidates:
        if trade.get('type') != 'BUY':
            continue
        if buys_done >= 2:
            break
        if n_positions + buys_done >= MAX_POSITIONS:
            break

        ticker = trade['ticker']
        price  = trade.get('price') or get_live_price(ticker) or 0
        if not price or price != price:  # check for NaN
            continue

        max_cost    = total_usd * MAX_POSITION_PCT
        position_sz = min(deployable, max_cost)
        if not price or price != price or price <= 0:
            continue
        shares      = int(position_sz / price)
        if shares <= 0:
            continue
        if shares <= 0:
            continue

        sl = trade.get('sl', round(price * 0.95, 2))
        tp = trade.get('tp', round(price * 1.10, 2))
        reason = trade.get('reason', f'Screener buy signal @ ${price:.2f}')
        cost = shares * price

        propose_trade('BUY', ticker, shares, price, sl, tp, reason,
                     rsi=trade.get('rsi', 0), volume=trade.get('volume', 0))
        log(f'Buy signal proposed: {shares}x {ticker} @ ${price:.2f}')
        buys_done += 1
        deployable -= cost
        n_positions += 1

    log('Monitor run complete')

if __name__ == '__main__':
    main()
