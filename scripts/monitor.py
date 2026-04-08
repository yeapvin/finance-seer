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
IBKR_CLI     = SCRIPTS / 'ibkr_trade.py'
SYNC_SCRIPT  = SCRIPTS / 'sync_from_ibkr.py'
KV_URL       = 'https://clean-eagle-92052.upstash.io'
KV_TOKEN     = 'gQAAAAAAAWeUAAIncDFiZmRiYzc1NDY1YjI0NjU3YTYwMzc4Y2Y4ZTIxZWUzNHAxOTIwNTI'
TG_TOKEN     = '8609316971:AAFhvA7fOyXRx5ch5Mm740ajcjMRD5brIr4'
TG_CHAT      = '786437034'
FINANCE_SEER = 'https://finance-seer.vercel.app'

MAX_POSITIONS    = 5
MIN_CASH_RESERVE = 0.20  # 20% cash reserve
MAX_POSITION_PCT = 0.20  # 20% max per position
APPROVAL_TIMEOUT = 180   # 3 minutes

# ── Helpers ───────────────────────────────────────────────────────────────────
def log(msg): print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def kv_set(data: dict):
    req = urllib.request.Request(f'{KV_URL}/set/portfolio',
        data=json.dumps(data).encode(),
        headers={'Authorization': f'Bearer {KV_TOKEN}', 'Content-Type': 'application/json'},
        method='POST')
    urllib.request.urlopen(req, timeout=10)

def send_telegram(msg: str, buttons=None) -> int | None:
    body: dict = {'chat_id': TG_CHAT, 'text': msg, 'parse_mode': 'Markdown'}
    if buttons:
        body['reply_markup'] = {'inline_keyboard': buttons}
    data = json.dumps(body).encode()
    req = urllib.request.Request(f'https://api.telegram.org/bot{TG_TOKEN}/sendMessage',
        data=data, headers={'Content-Type': 'application/json'})
    resp = json.loads(urllib.request.urlopen(req, timeout=10).read())
    return resp.get('result', {}).get('message_id')

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

def ibkr_trade(action: str, ticker: str, shares: int, price: float = None) -> dict:
    args = [sys.executable, str(IBKR_CLI), action, ticker, str(shares)]
    if price:
        args.append(str(round(price, 2)))
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    try:
        return json.loads(result.stdout)
    except:
        return {'error': result.stderr or result.stdout or 'Unknown'}

def get_live_price(ticker: str) -> float | None:
    try:
        url = f'https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        data = json.loads(urllib.request.urlopen(req, timeout=8).read())
        return data['chart']['result'][0]['meta']['regularMarketPrice']
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

def await_approval(signal_ts: float, ticker: str, action: str) -> str:
    """Wait up to 3 mins for APPROVE/REJECT. Default: APPROVE."""
    deadline = signal_ts + APPROVAL_TIMEOUT
    while time.time() < deadline:
        time.sleep(10)
        msgs = get_recent_messages(signal_ts)
        for m in msgs:
            if 'REJECT' in m or 'CANCEL' in m or ticker in m and 'NO' in m:
                return 'REJECT'
            if 'APPROVE' in m or 'EXECUTE' in m or 'YES' in m:
                return 'APPROVE'
    return 'APPROVE'  # auto-execute after timeout

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    log('Starting monitor run')

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
    total_usd = cash_usd + sum(pos.get('currentPrice', pos['buyPrice']) * pos['shares'] for pos in positions)

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
            emoji  = '🟢' if price >= pos['buyPrice'] else '🔴'
            pnl    = (price - pos['buyPrice']) * shares
            signal_ts = time.time()

            msg = (f"⚡ Trade Signal: SELL {shares}x *{pos['ticker']}* @ ${price:.2f}\n"
                   f"Reason: {reason}\n"
                   f"P&L: {'+' if pnl>=0 else ''}${pnl:.0f}\n"
                   f"Executing in 3 mins unless you reject.")
            send_telegram(msg, buttons=[[
                {'text': '✅ Execute Now', 'callback_data': f'APPROVE_SELL_{pos["ticker"]}'},
                {'text': '❌ Reject',      'callback_data': f'REJECT_SELL_{pos["ticker"]}'},
            ]])
            log(f'SL/TP triggered: SELL {shares}x {pos["ticker"]} @ ${price:.2f}')

            decision = await_approval(signal_ts, pos['ticker'], 'SELL')

            if decision == 'REJECT':
                send_telegram(f'❌ Trade cancelled: SELL {shares}x *{pos["ticker"]}*')
                log('Trade rejected by user')
                continue

            # Execute
            ibkr = ibkr_trade('SELL', pos['ticker'], shares, price)
            if ibkr.get('error'):
                send_telegram(f'⚠️ IBKR error: {ibkr["error"]}')
                log(f'IBKR error: {ibkr["error"]}')
                continue

            today = datetime.now().strftime('%Y-%m-%d')
            proceeds = price * shares
            p['cashByValue']['USD'] = round(cash_usd + proceeds, 2)
            p['positions'] = [x for x in p['positions'] if x['ticker'] != pos['ticker']]
            p.setdefault('closedPositions', []).append({
                'ticker': pos['ticker'], 'shares': shares,
                'buyDate': pos.get('buyDate'), 'buyPrice': pos['buyPrice'],
                'sellDate': today, 'sellPrice': price,
                'reason': reason, 'pnl': pnl, 'pnlPct': pnl/(pos['buyPrice']*shares)*100,
                'currency': 'USD'
            })
            p.setdefault('history', []).append({
                'date': today, 'action': 'SELL', 'ticker': pos['ticker'],
                'shares': shares, 'price': price, 'total': proceeds,
                'reason': reason, 'currency': 'USD'
            })
            push_portfolio(p)
            valueK = (p['cashByValue']['USD'] + sum(x.get('currentPrice',x['buyPrice'])*x['shares'] for x in p['positions'])) / 1000
            send_telegram(f'{emoji} Portfolio Trade: SELL {shares}x *{pos["ticker"]}* @ ${price:.2f} — {reason}. P&L: {"+" if pnl>=0 else ""}${abs(pnl):.0f}. Portfolio: ${valueK:.1f}K')
            log(f'SELL executed: {shares}x {pos["ticker"]} @ ${price:.2f}')
            cash_usd = p['cashByValue']['USD']

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

    # Call Finance Seer screener API
    log('Scanning market via Finance Seer screener...')
    try:
        req = urllib.request.Request(f'{FINANCE_SEER}/api/portfolio/monitor', method='POST')
        resp = json.loads(urllib.request.urlopen(req, timeout=120).read())
        candidates = resp.get('executedTrades', [])
        log(f'Screener returned {len(candidates)} candidates')
    except Exception as e:
        log(f'Screener error: {e}')
        return

    buys_done = 0
    for trade in candidates:
        if trade.get('type') != 'BUY':
            continue
        if buys_done >= 2:
            break
        if n_positions + buys_done >= MAX_POSITIONS:
            break

        ticker = trade['ticker']
        price  = get_live_price(ticker) or trade.get('price', 0)
        if not price:
            continue

        max_cost    = total_usd * MAX_POSITION_PCT
        position_sz = min(deployable, max_cost)
        shares      = int(position_sz / price)
        if shares <= 0:
            continue

        sl = trade.get('sl', round(price * 0.95, 2))
        tp = trade.get('tp', round(price * 1.10, 2))
        reason = trade.get('reason', f'Screener buy signal @ ${price:.2f}')
        cost = shares * price

        signal_ts = time.time()
        msg = (f"⚡ Buy Signal: BUY {shares}x *{ticker}* @ ${price:.2f}\n"
               f"Cost: ~${cost:,.0f} | TP ${tp:.2f} | SL ${sl:.2f}\n"
               f"_{reason[:120]}_\n"
               f"Executing in 3 mins unless you reject.")
        send_telegram(msg, buttons=[[
            {'text': '✅ Execute Now', 'callback_data': f'APPROVE_BUY_{ticker}'},
            {'text': '❌ Reject',      'callback_data': f'REJECT_BUY_{ticker}'},
        ]])
        log(f'Buy signal: {shares}x {ticker} @ ${price:.2f}')

        decision = await_approval(signal_ts, ticker, 'BUY')

        if decision == 'REJECT':
            send_telegram(f'❌ Trade cancelled: BUY {shares}x *{ticker}*')
            log('Buy rejected by user')
            continue

        ibkr = ibkr_trade('BUY', ticker, shares, price)
        if ibkr.get('error'):
            send_telegram(f'⚠️ IBKR error: {ibkr["error"]}')
            log(f'IBKR error: {ibkr["error"]}')
            continue

        today = datetime.now().strftime('%Y-%m-%d')
        p['positions'].append({
            'ticker': ticker, 'shares': shares,
            'avgCost': price, 'buyPrice': price, 'currentPrice': price,
            'buyDate': today, 'stopLoss': sl, 'takeProfit': tp,
            'signal': 'BUY', 'currency': 'USD', 'reason': reason,
            'ibkrOrderId': ibkr.get('orderId'),
        })
        p['cashByValue']['USD'] = round(p['cashByValue']['USD'] - cost, 2)
        p.setdefault('history', []).append({
            'date': today, 'action': 'BUY', 'ticker': ticker,
            'shares': shares, 'price': price, 'total': cost,
            'reason': reason, 'currency': 'USD'
        })
        p.setdefault('strategyNotes', []).append({
            'date': datetime.now().isoformat(),
            'note': f'Bought {shares} {ticker} @ ${price:.2f} (-${cost:,.0f}). SL ${sl} | TP ${tp}. Cash now ${p["cashByValue"]["USD"]:,.0f}.'
        })
        push_portfolio(p)
        valueK = (p['cashByValue']['USD'] + sum(x.get('currentPrice',x['buyPrice'])*x['shares'] for x in p['positions'])) / 1000
        send_telegram(f'🟢 Portfolio Trade: BUY {shares}x *{ticker}* @ ${price:.2f} — {reason[:100]}. TP ${tp:.2f} | SL ${sl:.2f}. Portfolio: ${valueK:.1f}K')
        log(f'BUY executed: {shares}x {ticker} @ ${price:.2f}')
        buys_done += 1
        deployable -= cost
        n_positions += 1

    log('Monitor run complete')

if __name__ == '__main__':
    main()
