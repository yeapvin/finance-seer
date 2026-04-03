# Finance Seer - AI-Powered Stock Analysis Platform

A professional, full-featured stock analysis web application built with Next.js 14, TypeScript, and real-time market data from Yahoo Finance.

## 🎯 Features

### Stock Search & Dashboard
- Real-time stock search by ticker or company name
- Live price quotes with change percentage and volume
- Market cap, P/E ratio, dividend yield, and 52-week range
- Clean, responsive dashboard with dark mode

### Interactive Charts
- Lightweight Charts (TradingView) for professional candlestick and line charts
- Multiple timeframes: 1D, 5D, 1M, 3M, 6M, 1Y, 5Y
- Real-time volume visualization

### Technical Indicators
- **Moving Averages**: SMA (20, 50, 200) & EMA (12, 26)
- **Momentum**: RSI (Relative Strength Index)
- **Trend**: MACD with signal line and histogram
- **Volatility**: Bollinger Bands
- **Oscillators**: Stochastic K%D
- Toggleable overlay on charts for flexible analysis

### Chart Pattern Recognition
Automatic detection with confidence scoring:
- Double Top / Double Bottom
- Head and Shoulders / Inverse
- Ascending / Descending Triangles
- Bull / Bear Flags
- Cup and Handle
- Support and Resistance Levels

### AI-Powered Analysis Reports
Comprehensive investment analysis featuring:
- **Executive Summary**: Quick overview of the stock
- **Technical Analysis**: Indicator-based insights
- **Fundamental Analysis**: Valuation metrics assessment
- **News Sentiment**: Market sentiment analysis
- **Risk Assessment**: Key risks and considerations
- **Clear Recommendation**: BUY / SELL / HOLD with reasoning
- **Price Targets**: Support and resistance levels
- **Trading Strategy**: Entry points, stop loss, take profit
- **PDF Export**: Download reports for offline review

### User Authentication & Profiles
- Secure sign-up/login with bcrypt password hashing
- User watchlists and saved preferences
- Analysis history tracking
- Dark/light mode toggle
- Profile management

### Stock Monitoring & Alerts
Create intelligent alerts for:
- Price crosses (above/below threshold)
- RSI conditions (overbought >70, oversold <30)
- MACD crossovers
- Volume spikes
- Trend reversals
- Pattern breakouts

Real-time alert checking with status dashboard and triggered notifications.

### Data Export
- CSV export of analysis reports
- Chart data export for external analysis
- PDF report downloads

## 🛠️ Tech Stack

### Frontend
- **Next.js 14** with App Router and TypeScript
- **React 18** for UI components
- **TailwindCSS** for styling
- **Lightweight Charts** by TradingView for professional charts
- **Lucide React** for icons

### Backend
- **Next.js API Routes** (serverless functions)
- **TypeScript** for type safety
- **better-sqlite3** for persistent user data
- **bcryptjs** for password hashing

### Data Sources
- **Yahoo Finance** (yahoo-finance2) - FREE, no API key required
- **OpenAI-compatible LLM** for analysis generation (optional, with fallback)

### Database
- **SQLite** with WAL mode for reliability
- Automatic schema initialization
- Indexes for query optimization

## 📋 Project Structure

```
finance-seer/
├── app/
│   ├── layout.tsx                 # Root layout with navbar
│   ├── page.tsx                   # Landing page
│   ├── login/page.tsx             # Authentication
│   ├── signup/page.tsx
│   ├── stock/[ticker]/page.tsx    # Main stock analysis view
│   ├── profile/page.tsx           # User profile
│   ├── watchlist/page.tsx         # Saved stocks
│   ├── alerts/page.tsx            # Alert management
│   ├── globals.css
│   └── api/
│       ├── auth/signup/route.ts
│       ├── auth/login/route.ts
│       ├── stock/[ticker]/route.ts
│       ├── stock/[ticker]/history/route.ts
│       ├── stock/[ticker]/news/route.ts
│       ├── analyze/route.ts
│       ├── watchlist/route.ts
│       ├── alerts/route.ts
│       ├── alerts/check/route.ts
│       ├── export/route.ts
│       └── search/route.ts
├── components/
│   ├── Navbar.tsx
│   ├── ThemeToggle.tsx
│   ├── StockSearch.tsx
│   ├── StockSummary.tsx
│   ├── StockChart.tsx
│   ├── IndicatorPanel.tsx
│   ├── PatternOverlay.tsx
│   ├── AnalysisReport.tsx
│   ├── WatchlistCard.tsx
│   ├── AlertConfig.tsx
│   └── PDFReport.tsx
├── lib/
│   ├── db.ts                      # SQLite setup
│   ├── yahoo.ts                   # Yahoo Finance wrapper
│   ├── indicators.ts              # Technical indicator calculations
│   ├── patterns.ts                # Pattern recognition algorithms
│   ├── analysis.ts                # LLM analysis generation
│   ├── alerts.ts                  # Alert evaluation logic
│   └── auth.ts                    # Authentication utilities
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── next.config.js
└── README.md
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ (for better-sqlite3 compatibility)
- npm or yarn

### Installation

1. **Clone and install dependencies:**
```bash
cd finance-seer
npm install
```

2. **Set up environment (optional for LLM features):**
```bash
# Create .env.local
OPENAI_API_KEY=your_api_key_here
OPENAI_API_URL=https://api.openai.com/v1/chat/completions  # Optional, defaults to OpenAI

# The app works without these - analysis falls back to mock data
```

3. **Run the development server:**
```bash
npm run dev
```

4. **Open [http://localhost:3000](http://localhost:3000)**

### Demo Account
- Email: `demo@finance-seer.com`
- Password: `demo123`
- Or use "Try Demo Account" button on login page

## 📊 Technical Highlights

### Accurate Technical Indicators
All indicators use mathematically correct algorithms:
- **SMA/EMA**: Standard moving average calculations with exponential weighting
- **RSI**: 14-period relative strength index with average gain/loss calculation
- **MACD**: 12/26/9 exponential moving average convergence divergence
- **Bollinger Bands**: 20-period SMA with 2-standard deviation bands
- **Stochastic**: K%D oscillator with 14/3/3 periods

### Real Pattern Recognition
Pattern detection uses peak/trough identification:
- Calculates local highs and lows over lookback windows
- Measures pattern proportions and tolerances
- Assigns confidence scores based on match quality
- Identifies support/resistance levels from historical extrema

### Efficient Data Management
- **5-minute cache** for stock quotes to minimize API calls
- **SQLite with indexes** for sub-millisecond queries
- **Progressive loading** for charts and analysis
- **Client-side calculations** for indicators (no server processing needed)

### Secure Authentication
- **bcrypt hashing** with 10 salt rounds
- **Server-side validation** for all auth routes
- **Client-side session storage** for user context
- **Protected routes** requiring login for watchlist/alerts

## 🔧 Configuration

### LLM Integration
The app uses OpenAI-compatible API format (works with any provider):

```typescript
// in lib/analysis.ts
const apiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions'
const apiKey = process.env.OPENAI_API_KEY
```

Supported providers:
- OpenAI (GPT-3.5-turbo, GPT-4)
- Azure OpenAI
- Local LLMs (llama.cpp, Ollama)
- Other OpenAI-compatible services

### Database
SQLite database is auto-created at `data/finance.db`:
- **Users table**: Authentication and preferences
- **Watchlist table**: Saved stocks per user
- **Alerts table**: User-configured alerts
- **Analysis history**: Saved reports
- **Price cache**: Recent quote snapshots

## 📈 API Endpoints

### Stock Data
- `GET /api/stock/[ticker]` - Current price and metrics
- `GET /api/stock/[ticker]/history?period=1mo` - Historical data with indicators
- `GET /api/stock/[ticker]/news` - News and sentiment
- `GET /api/search?q=query` - Stock search

### Authentication
- `POST /api/auth/signup` - Create new account
- `POST /api/auth/login` - Sign in

### User Features
- `POST /api/watchlist` - Manage watchlist
- `POST /api/alerts` - Create/update alerts
- `POST /api/alerts/check` - Evaluate triggered alerts
- `POST /api/analyze` - Generate AI analysis
- `POST /api/export` - Export data/reports

## 🎨 Design

### Dark Mode Default
- Navy/charcoal background (#0f172a - #1e293b)
- Slate gray borders and text (#94a3b8 - #cbd5e1)
- Bright accents: Green (#10b981) for gains, Red (#ef4444) for losses, Blue (#3b82f6) for UI

### Responsive Layout
- Mobile-first design
- Breakpoints: sm (640px), md (768px), lg (1024px)
- Touch-friendly buttons and inputs
- Optimized for all screen sizes

### Component Architecture
- **Server Components**: Layouts, static pages
- **Client Components**: Interactive features, state management
- **Hybrid Approach**: Minimal client-side rendering with optimal performance

## 🔐 Security Considerations

1. **Password Security**: bcrypt with 10 salt rounds
2. **SQL Injection**: Parameterized queries via better-sqlite3
3. **CORS**: Same-origin only by design (Next.js API routes)
4. **Secrets**: Environment variables for API keys
5. **Input Validation**: Type checking and bounds checking
6. **Rate Limiting**: Built-in by serverless architecture

## 📦 Dependencies

### Core
- `next`: React framework with serverless API routes
- `react`: UI library
- `typescript`: Type safety

### Styling
- `tailwindcss`: Utility-first CSS
- `lucide-react`: Icon library

### Charts & Data
- `lightweight-charts`: Professional financial charts
- `yahoo-finance2`: Stock data (FREE, no key required)

### Database
- `better-sqlite3`: Synchronous SQLite driver
- No separate database server needed

### Authentication
- `bcryptjs`: Password hashing
- `next-auth`: Session management framework

### Export
- `@react-pdf/renderer`: PDF generation
- `html2canvas`: HTML to image conversion
- `jspdf`: PDF manipulation

### Utilities
- `date-fns`: Date formatting
- `zod`: Type validation
- `zustand`: State management (optional)
- `axios`: HTTP client
- `clsx`: Class name utilities

## 🚀 Deployment

### Vercel (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Environment variables
# Add OPENAI_API_KEY in Vercel dashboard (Settings → Environment Variables)
```

**Note**: SQLite databases work on Vercel with the `/tmp` directory, which is ephemeral. For persistent data, consider:
- PostgreSQL or MySQL (free tier: Railway, Render)
- Supabase (PostgreSQL with auth)
- MongoDB Atlas (free tier)

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Self-Hosted
```bash
npm run build
npm start
```

## 📝 Usage Examples

### Analyzing a Stock
1. Go to homepage and click "Start Analyzing"
2. Search for a stock (e.g., "AAPL")
3. View real-time price, volume, and metrics
4. Adjust timeframe and toggle technical indicators
5. Click "Generate AI Analysis" for comprehensive report
6. Save to watchlist and set up alerts

### Creating Alerts
1. Navigate to stock page
2. Click "Add Alert"
3. Select alert type (price cross, RSI, volume spike, etc.)
4. Set threshold value
5. Check /alerts page to see active monitors

### Exporting Reports
1. Generate AI analysis
2. Click "Download" button
3. Report exports as CSV with full analysis

## 🧪 Testing

### Manual Testing Checklist
- [ ] Stock search functionality
- [ ] Chart rendering with different timeframes
- [ ] Technical indicators toggle on/off
- [ ] Pattern detection and confidence scores
- [ ] AI analysis generation
- [ ] Watchlist add/remove
- [ ] Alert creation and evaluation
- [ ] User authentication flow
- [ ] Dark/light mode toggle
- [ ] Mobile responsiveness
- [ ] Export functionality

### Demo Data
Built-in trending stocks on homepage with realistic data for immediate testing.

## 🐛 Troubleshooting

### "Module not found: better-sqlite3"
Better-sqlite3 requires native compilation. Ensure:
```bash
npm install --build-from-source better-sqlite3
```

### "Cannot find module yahoo-finance2"
```bash
npm install yahoo-finance2@latest
```

### SQLite "database is locked"
This occurs with concurrent writes. Solution: Ensure only one process accesses the database. In production, use PostgreSQL instead.

### Charts not rendering
- Ensure data is fetched successfully
- Check browser console for errors
- Verify Lightweight Charts CDN availability

### LLM Analysis returns mock data
Either:
1. Set `OPENAI_API_KEY` environment variable
2. Or provide any other OpenAI-compatible API

## 📚 Learning Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [TailwindCSS](https://tailwindcss.com)
- [Lightweight Charts](https://tradingview.github.io/lightweight-charts/)
- [Yahoo Finance API](https://github.com/mifi/yahoo-finance2)
- [Technical Analysis](https://en.wikipedia.org/wiki/Technical_analysis)

## 📄 License

MIT License - Feel free to use for personal or commercial projects.

## 🤝 Contributing

Contributions welcome! Areas for improvement:
- More technical indicators (Keltner Channels, ATR, etc.)
- Screeners for stock filtering
- Portfolio tracking
- Options analysis
- Earnings calendar integration
- Advanced charting (Renko, Point & Figure)

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Review API endpoint documentation
3. Check browser console for client-side errors
4. Review server logs for API errors

---

**Built with ❤️ using Next.js, TypeScript, and modern web technologies.**

Happy analyzing! 📊
