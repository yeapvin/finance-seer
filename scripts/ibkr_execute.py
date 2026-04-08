#!/usr/bin/env python3
"""
IBKR Trade Executor for Finance Seer
Connects to IB Gateway and executes a single trade (BUY or SELL).

Usage:
  python3 ibkr_execute.py BUY AAPL 10 --price 250.00
  python3 ibkr_execute.py SELL AAPL 10
  python3 ibkr_execute.py STATUS            # account summary
  python3 ibkr_execute.py POSITIONS         # open positions

Returns JSON with result.
"""
import sys
import json
import time
import argparse

IBKR_HOST = '172.23.160.1'
IBKR_PORT = 4002
IBKR_ACCOUNT = 'DU7992310'
MAX_PORTFOLIO_USD = 100_000  # sub-portfolio cap

def connect():
    from ib_insync import IB
    ib = IB()
    ib.connect(IBKR_HOST, IBKR_PORT, clientId=10, timeout=10)
    return ib

def get_usd_rate(ib) -> float:
    """Get SGD/USD rate to check sub-portfolio value in USD"""
    try:
        from ib_insync import Forex
        contract = Forex('SGDUSD')
        ib.qualifyContracts(contract)
        ticker = ib.reqMktData(contract, '', False, False)
        ib.sleep(1)
        rate = ticker.last or ticker.close or 0.74
        ib.cancelMktData(contract)
        return float(rate)
    except:
        return 0.74  # fallback SGD/USD

def get_account_summary(ib) -> dict:
    summary = ib.accountSummary(IBKR_ACCOUNT)
    result = {}
    for item in summary:
        result[item.tag] = {'value': item.value, 'currency': item.currency}
    return result

def get_positions(ib) -> list:
    positions = ib.positions(IBKR_ACCOUNT)
    return [
        {
            'ticker': pos.contract.symbol,
            'shares': pos.position,
            'avgCost': pos.avgCost,
            'marketValue': pos.marketValue if hasattr(pos, 'marketValue') else None,
        }
        for pos in positions
    ]

def get_live_price(ib, ticker: str) -> float:
    from ib_insync import Stock
    contract = Stock(ticker, 'SMART', 'USD')
    ib.qualifyContracts(contract)
    ticker_data = ib.reqMktData(contract, '', False, False)
    ib.sleep(2)
    price = ticker_data.last or ticker_data.close or 0
    ib.cancelMktData(contract)
    return float(price)

def place_order(ib, action: str, ticker: str, quantity: int, limit_price: float = None) -> dict:
    from ib_insync import Stock, MarketOrder, LimitOrder

    contract = Stock(ticker, 'SMART', 'USD')
    ib.qualifyContracts(contract)

    if limit_price:
        order = LimitOrder(action, quantity, limit_price, account=IBKR_ACCOUNT, tif='DAY')
    else:
        order = MarketOrder(action, quantity, account=IBKR_ACCOUNT)

    trade = ib.placeOrder(contract, order)
    ib.sleep(3)

    return {
        'orderId': trade.order.orderId,
        'ticker': ticker,
        'action': action,
        'quantity': quantity,
        'orderType': 'LMT' if limit_price else 'MKT',
        'limitPrice': limit_price,
        'status': trade.orderStatus.status,
        'filled': trade.orderStatus.filled,
        'avgFillPrice': trade.orderStatus.avgFillPrice,
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['BUY', 'SELL', 'STATUS', 'POSITIONS', 'PRICE'])
    parser.add_argument('ticker', nargs='?')
    parser.add_argument('quantity', nargs='?', type=int)
    parser.add_argument('--price', type=float, default=None)
    args = parser.parse_args()

    try:
        ib = connect()

        if args.command == 'STATUS':
            summary = get_account_summary(ib)
            usd_rate = get_usd_rate(ib)
            nlv_sgd = float(summary.get('NetLiquidation', {}).get('value', 0))
            cash_sgd = float(summary.get('TotalCashValue', {}).get('value', 0))
            print(json.dumps({
                'account': IBKR_ACCOUNT,
                'nlv_sgd': nlv_sgd,
                'cash_sgd': cash_sgd,
                'nlv_usd_approx': round(nlv_sgd * usd_rate, 2),
                'cash_usd_approx': round(cash_sgd * usd_rate, 2),
                'sub_portfolio_cap_usd': MAX_PORTFOLIO_USD,
                'usd_rate': usd_rate,
            }, indent=2))

        elif args.command == 'POSITIONS':
            positions = get_positions(ib)
            print(json.dumps(positions, indent=2))

        elif args.command == 'PRICE':
            if not args.ticker:
                print(json.dumps({'error': 'ticker required'}))
                sys.exit(1)
            price = get_live_price(ib, args.ticker.upper())
            print(json.dumps({'ticker': args.ticker.upper(), 'price': price}))

        elif args.command in ('BUY', 'SELL'):
            if not args.ticker or not args.quantity:
                print(json.dumps({'error': 'ticker and quantity required'}))
                sys.exit(1)

            result = place_order(ib, args.command, args.ticker.upper(), args.quantity, args.price)
            print(json.dumps(result, indent=2))

        ib.disconnect()

    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
