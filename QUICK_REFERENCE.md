# Finance Oracle - Quick Reference Guide

## 🚀 Quick Start (Copy & Paste)

```bash
cd /home/ubuntu/.openclaw/workspace/finance-oracle
npm install
npm run dev
# Open http://localhost:3000
```

## 🔑 Demo Account
- **Email:** demo@finance-oracle.com
- **Password:** demo123
- **Or:** Click "Try Demo Account" button

## 📊 Key Features at a Glance

| Feature | Location | How to Use |
|---------|----------|-----------|
| **Stock Search** | Homepage/Navbar | Type ticker or company name |
| **Live Chart** | `/stock/[ticker]` | Change timeframe with buttons |
| **Indicators** | Chart page | Toggle in "Technical Indicators" panel |
| **Patterns** | Chart page | Auto-detected, shown in "Detected Patterns" |
| **AI Analysis** | Chart page | Click "Generate AI Analysis" button |
| **Watchlist** | `/watchlist` | Click bookmark icon on stock pages |
| **Alerts** | `/alerts` | Click "Add Alert" on stock pages |
| **Profile** | `/profile` | Access via navbar profile icon |
| **Export** | Analysis report | Click "Download" button |

## 🔗 Page Routes

```
/                      # Home page
/login                 # Login page
/signup                # Registration page
/stock/AAPL            # Stock analysis (replace AAPL with any ticker)
/watchlist             # Your saved stocks (logged in only)
/alerts                # Your alerts dashboard (logged in only)
/profile               # User profile & settings (logged in only)
```

## 🌐 API Endpoints

```
GET  /api/stock/AAPL                     # Get current price
GET  /api/stock/AAPL/history?period=1mo # Historical data + indicators
GET  /api/stock/AAPL/news                # News & sentiment
GET  /api/search?q=apple                 # Search stocks
POST /api/auth/login                     # Login
POST /api/auth/signup                    # Register
POST /api/watchlist                      # Add/remove/list watchlist
POST /api/alerts                         # Create/manage alerts
POST /api/analyze                        # Generate analysis
POST /api/export                         # Export data
```

## 📈 Technical Indicators

| Indicator | Type | What It Shows |
|-----------|------|---------------|
| SMA 20 | Trend | Short-term trend (orange) |
| SMA 50 | Trend | Medium-term trend (purple) |
| SMA 200 | Trend | Long-term trend (pink) |
| EMA 12/26 | Trend | Faster moving averages |
| RSI | Momentum | Overbought (>70) / Oversold (<30) |
| MACD | Trend | Momentum shifts & crossovers |
| Bollinger Bands | Volatility | Price range & breakouts |
| Stochastic | Momentum | K%D oscillator |
| Volume | Volume | Trading activity bars |

## 🔔 Alert Types

| Type | Trigger | Example |
|------|---------|---------|
| Price Above | Stock rises above threshold | Alert when AAPL > $150 |
| Price Below | Stock falls below threshold | Alert when AAPL < $140 |
| Volume Spike | Trading volume surges | Alert on unusual volume |
| RSI Overbought | RSI > 70 (may be overheated) | Potential pullback |
| RSI Oversold | RSI < 30 (may be undervalued) | Potential bounce |
| MACD Crossover | MACD signal line cross | Trend change indicator |

## 🎨 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Search stock or submit form |
| `Escape` | Close dropdowns/modals |
| `Tab` | Navigate form fields |

## 🔐 Authentication

### Sign Up Flow
1. Go to `/signup`
2. Enter email, username, password
3. Click "Sign Up"
4. Redirected to home page (logged in)

### Login Flow
1. Go to `/login`
2. Enter email and password
3. Click "Sign In"
4. Or click "Try Demo Account"

### Logout
1. Click profile icon (top right)
2. Click "Sign Out"
3. Redirected to login page

## 💾 Database

**Location:** `data/finance.db` (auto-created)

**Tables:**
- `users` - Accounts and preferences
- `watchlist` - Saved stocks per user
- `alerts` - Alert configurations
- `analysis_history` - Saved reports
- `price_cache` - Quote snapshots

**Inspect with:**
```bash
sqlite3 data/finance.db
> SELECT * FROM users;
> .schema watchlist
> .exit
```

## ⚙️ Configuration

### Environment Variables (Optional)
Create `.env.local`:
```
OPENAI_API_KEY=your_key_here
OPENAI_API_URL=https://api.openai.com/v1/chat/completions
```

App works without these - AI analysis falls back to mock data.

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Port 3000 in use | Use `PORT=3001 npm run dev` |
| Module errors | Run `npm install` again |
| Type errors | Run `npm run build` to check |
| Database locked | Restart dev server |
| Chart not showing | Check browser console, refresh page |

## 📁 Key Files to Know

```
app/stock/[ticker]/page.tsx    # Main stock view - START HERE
lib/indicators.ts               # Indicator calculations
lib/patterns.ts                 # Pattern detection
lib/analysis.ts                 # AI analysis logic
components/StockChart.tsx       # Chart rendering
package.json                    # Dependencies & scripts
```

## 🔄 Development Workflow

### Make Changes
1. Edit files in IDE
2. Dev server auto-reloads
3. View changes in browser

### Add Feature
1. Create component in `/components`
2. Or create API route in `/app/api`
3. Import and use in page
4. Test in browser

### Debug
```bash
# See all requests
npm run dev  # Check terminal

# Browser DevTools
# F12 → Console & Network tabs
```

## 📦 Dependencies (Key Libraries)

```json
{
  "next": "^14.2.0",                    # React framework
  "react": "^18.3.1",                   # UI library
  "lightweight-charts": "^4.1.1",       # Charts
  "yahoo-finance2": "^2.14.0",          # Stock data
  "tailwindcss": "^3.4.3",              # Styling
  "better-sqlite3": "^9.2.2",           # Database
  "bcryptjs": "^2.4.3",                 # Password hashing
  "@react-pdf/renderer": "^3.16.0"      # PDF export
}
```

## 🚀 Deployment

### Vercel (Easiest)
```bash
npm install -g vercel
vercel
# Follow prompts, add OPENAI_API_KEY
```

### Self-Hosted
```bash
npm run build
npm start
# Visit http://your-domain.com:3000
```

See `DEPLOYMENT.md` for more options.

## 📚 Full Documentation

- **README.md** - Complete user & technical docs
- **DEVELOPMENT.md** - Developer guide with examples
- **DEPLOYMENT.md** - Deployment instructions
- **PROJECT_SUMMARY.md** - Full feature list

## 💡 Tips & Tricks

1. **Dark Mode**: Auto-enabled, toggle in profile
2. **Demo Data**: Real stocks loaded on homepage
3. **Save Stocks**: Click bookmark to add to watchlist
4. **Export Reports**: Download AI analysis as CSV
5. **Real-time Data**: 5-minute cache for performance
6. **Search Tips**: Type ticker (AAPL) or name (Apple)
7. **Alert Checking**: Runs every 30 seconds in browser
8. **Multiple Indicators**: Overlay on same chart

## 🎯 Common Tasks

### View Stock Analysis
```
1. Home page → Start Analyzing
2. Or search in navbar
3. Click "Generate AI Analysis"
4. Read report with recommendations
```

### Add to Watchlist
```
1. On stock page
2. Click bookmark icon
3. View in /watchlist
```

### Set Price Alert
```
1. On stock page
2. Click "Add Alert"
3. Select type (price above/below)
4. Enter threshold
5. Check /alerts page
```

### Export Report
```
1. Generate analysis
2. Click "Download"
3. CSV file saved to computer
```

## 🎓 Learning Resources

- [Next.js Docs](https://nextjs.org/docs)
- [React Docs](https://react.dev)
- [TailwindCSS](https://tailwindcss.com)
- [Technical Analysis](https://en.wikipedia.org/wiki/Technical_analysis)
- [Stock Market Basics](https://www.investopedia.com/)

## 📞 Support

**Issue**: Not working?
1. Check console: `F12` → Console tab
2. Restart dev server
3. Clear cache: `Ctrl+Shift+Delete`
4. Check `.env` file
5. Review logs in terminal

---

**Happy Analyzing! 📊**

For detailed info, see README.md or DEVELOPMENT.md
