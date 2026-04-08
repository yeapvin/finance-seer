#!/usr/bin/env python3
"""
Propose a trade via Telegram — sends signal message and exits.
The main OpenClaw session handles approve/reject in real-time.

Usage: python3 propose_trade.py BUY AAPL 50 258.82 245.00 284.00 "RSI oversold at support"
"""
import sys, json, urllib.request

TG_TOKEN = '8609316971:AAFhvA7fOyXRx5ch5Mm740ajcjMRD5brIr4'
TG_CHAT  = '786437034'

def send(msg, buttons=None):
    body = {'chat_id': TG_CHAT, 'text': msg, 'parse_mode': 'Markdown'}
    if buttons:
        body['reply_markup'] = {'inline_keyboard': buttons}
    req = urllib.request.Request(
        f'https://api.telegram.org/bot{TG_TOKEN}/sendMessage',
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(req, timeout=10)

if __name__ == '__main__':
    action = sys.argv[1].upper()   # BUY or SELL
    ticker = sys.argv[2].upper()
    shares = int(sys.argv[3])
    price  = float(sys.argv[4])
    sl     = float(sys.argv[5])
    tp     = float(sys.argv[6])
    reason = sys.argv[7] if len(sys.argv) > 7 else ''
    cost   = shares * price

    emoji = '🟢' if action == 'BUY' else '🔴'
    msg = (f"⚡ *Trade Signal: {action} {shares}x {ticker}*\n"
           f"Price: ${price:.2f} | Cost: ~${cost:,.0f}\n"
           f"SL: ${sl:.2f} | TP: ${tp:.2f}\n"
           f"_{reason[:120]}_\n\n"
           f"Executing in 3 mins unless you reject.")

    send(msg, buttons=[[
        {'text': '✅ Execute Now', 'callback_data': f'APPROVE_{action}_{ticker}'},
        {'text': '❌ Reject',      'callback_data': f'REJECT_{action}_{ticker}'},
    ]])
    print(json.dumps({'sent': True, 'action': action, 'ticker': ticker, 'shares': shares, 'price': price, 'sl': sl, 'tp': tp, 'reason': reason}))
