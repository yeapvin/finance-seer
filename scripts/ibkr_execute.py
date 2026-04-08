#!/usr/bin/env python3
"""
IBKR Trade Executor with commission tracking.
Places a limit order, waits for fill, returns fill price + commission.

Usage:
  python3 ibkr_execute.py BUY AAPL 50 250.00
  python3 ibkr_execute.py SELL AAPL 50 260.00
Returns JSON with: orderId, filled, avgFillPrice, commission, totalCost
"""
import sys, json, time
from ib_insync import IB, Stock, LimitOrder

HOST    = '172.23.160.1'
PORT    = 4002
ACCOUNT = 'DU7992310'
FILL_WAIT_SECS = 10   # wait up to 10s for fill confirmation
CANCEL_AFTER   = 30 * 60  # auto-cancel after 30 min

def connect(client_id=15):
    ib = IB()
    ib.connect(HOST, PORT, clientId=client_id, timeout=15)
    return ib

def get_commission(ib, order_id: int) -> float:
    """Sum commission from all fills for this order."""
    total = 0.0
    for fill in ib.fills():
        if fill.execution.orderId == order_id and fill.commissionReport:
            c = fill.commissionReport.commission
            if c and c == c:  # not NaN
                total += c
    return round(total, 4)

def main():
    if len(sys.argv) < 5:
        print(json.dumps({'error': 'Usage: ibkr_execute.py BUY/SELL TICKER SHARES PRICE'}))
        sys.exit(1)

    action = sys.argv[1].upper()
    ticker = sys.argv[2].upper()
    shares = int(sys.argv[3])
    price  = round(float(sys.argv[4]), 2)

    try:
        ib = connect()
    except Exception as e:
        print(json.dumps({'error': f'Connection failed: {e}'}))
        sys.exit(1)

    try:
        contract = Stock(ticker, 'SMART', 'USD')
        ib.qualifyContracts(contract)

        order = LimitOrder(action, shares, price, account=ACCOUNT, tif='DAY')
        trade = ib.placeOrder(contract, order)
        ib.sleep(FILL_WAIT_SECS)

        order_id  = trade.order.orderId
        status    = trade.orderStatus.status
        filled    = trade.orderStatus.filled
        avg_price = trade.orderStatus.avgFillPrice or price
        commission = get_commission(ib, order_id)

        # Calculate total cost including commission
        if action == 'BUY':
            total_cost = round(avg_price * filled + commission, 2)
        else:
            total_proceeds = round(avg_price * filled - commission, 2)
            total_cost = total_proceeds  # for SELL, this is net proceeds

        result = {
            'success':      True,
            'orderId':      order_id,
            'ticker':       ticker,
            'action':       action,
            'shares':       shares,
            'limitPrice':   price,
            'filled':       filled,
            'avgFillPrice': round(avg_price, 4) if avg_price else 0,
            'commission':   commission,
            'totalCost':    total_cost,  # BUY: cost+commission, SELL: proceeds-commission
            'status':       status,
            'orderType':    'LMT',
            'autoCancel':   '30 min' if filled < shares else 'n/a',
        }
        print(json.dumps(result))

        # Schedule auto-cancel if partial/unfilled
        if filled < shares:
            import threading
            def cancel_later():
                time.sleep(CANCEL_AFTER - FILL_WAIT_SECS)
                try:
                    ib2 = connect(client_id=16)
                    for o in ib2.openOrders():
                        if o.orderId == order_id:
                            ib2.cancelOrder(o)
                            ib2.sleep(1)
                            import urllib.request
                            TG_TOKEN = '8609316971:AAFhvA7fOyXRx5ch5Mm740ajcjMRD5brIr4'
                            msg = json.dumps({'chat_id': '786437034',
                                'text': f'⏰ Order #{order_id} ({action} {shares}x {ticker} @ ${price}) cancelled — not filled within 30 min.'})
                            req = urllib.request.Request(
                                f'https://api.telegram.org/bot{TG_TOKEN}/sendMessage',
                                data=msg.encode(), headers={'Content-Type': 'application/json'})
                            urllib.request.urlopen(req, timeout=10)
                    ib2.disconnect()
                except: pass
            t = threading.Thread(target=cancel_later, daemon=True)
            t.start()
            t.join(timeout=1)

    except Exception as e:
        print(json.dumps({'error': str(e)}))
    finally:
        ib.disconnect()

if __name__ == '__main__':
    main()
