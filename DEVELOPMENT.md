# Finance Seer - Development Guide

## 🛠️ Development Environment Setup

### Prerequisites
- Node.js 18.17+ ([download](https://nodejs.org/))
- npm 9+ (comes with Node.js)
- Git ([download](https://git-scm.com/))
- VS Code or any code editor

### Quick Start

1. **Clone and navigate:**
   ```bash
   cd /home/ubuntu/.openclaw/workspace/finance-seer
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run development server:**
   ```bash
   npm run dev
   ```

4. **Open browser:**
   - Navigate to [http://localhost:3000](http://localhost:3000)
   - Hot-reload enabled for all changes

## 📁 Code Structure

### App Directory (`/app`)
Next.js 14 App Router - file-based routing:
- `page.tsx` - Main route component
- `layout.tsx` - Layout wrapper for route
- `[param]/page.tsx` - Dynamic routes

### API Routes (`/app/api`)
Serverless functions:
```
api/
├── auth/                    # Authentication
│   ├── login/route.ts
│   └── signup/route.ts
├── stock/[ticker]/          # Stock data endpoints
│   ├── route.ts            # Current price
│   ├── history/route.ts    # Historical + indicators
│   └── news/route.ts       # News sentiment
├── analyze/route.ts        # AI analysis generation
├── watchlist/route.ts      # Watchlist management
├── alerts/                  # Alert system
│   ├── route.ts            # CRUD operations
│   └── check/route.ts      # Trigger evaluation
├── export/route.ts         # Data export
└── search/route.ts         # Stock search
```

### Components (`/components`)
Reusable React components:
- **UI**: `Navbar`, `ThemeToggle`, `AlertConfig`
- **Charts**: `StockChart`, `IndicatorPanel`, `PatternOverlay`
- **Data**: `StockSearch`, `StockSummary`, `WatchlistCard`
- **Reports**: `AnalysisReport`, `PDFReport`

### Libraries (`/lib`)
Core business logic:
- `db.ts` - SQLite database setup and queries
- `yahoo.ts` - Yahoo Finance API wrapper
- `indicators.ts` - Technical indicator calculations
- `patterns.ts` - Pattern recognition algorithms
- `analysis.ts` - LLM integration for reports
- `alerts.ts` - Alert evaluation logic
- `auth.ts` - Authentication utilities

## 🔧 Common Development Tasks

### Adding a New API Endpoint

1. **Create route file:**
   ```typescript
   // app/api/example/route.ts
   import { NextRequest, NextResponse } from 'next/server'

   export async function GET(request: NextRequest) {
     try {
       // Your logic here
       return NextResponse.json({ data: 'result' })
     } catch (error) {
       return NextResponse.json({ error: 'Failed' }, { status: 500 })
     }
   }
   ```

2. **Use in client:**
   ```typescript
   const response = await fetch('/api/example')
   const data = await response.json()
   ```

### Adding a New Page

1. **Create page file:**
   ```typescript
   // app/newpage/page.tsx
   export default function NewPage() {
     return <div>Content</div>
   }
   ```

2. **Auto-accessible at:** `/newpage`

### Adding a New Component

1. **Create component file:**
   ```typescript
   // components/MyComponent.tsx
   'use client'  // If using client-side features
   
   export function MyComponent() {
     return <div>Component</div>
   }
   ```

2. **Use in pages:**
   ```typescript
   import { MyComponent } from '@/components/MyComponent'
   ```

### Adding a New Indicator

1. **Add calculation to `lib/indicators.ts`:**
   ```typescript
   export function calculateCustomIndicator(prices: number[]): number[] {
     // Implementation
     return results
   }
   ```

2. **Update `calculateAllIndicators()`:**
   ```typescript
   export function calculateAllIndicators(...) {
     return {
       ...existing,
       customIndicator: calculateCustomIndicator(prices),
     }
   }
   ```

3. **Add toggle in `IndicatorPanel.tsx`**

### Adding Database Functionality

1. **Create function in `lib/db.ts` or related:**
   ```typescript
   export function myFunction(userId: string) {
     const db = getDb()
     return db.prepare('SELECT * FROM table WHERE user_id = ?').all(userId)
   }
   ```

2. **Use in API routes:**
   ```typescript
   import { myFunction } from '@/lib/db'

   export async function GET(request: NextRequest) {
     const result = myFunction(userId)
     return NextResponse.json(result)
   }
   ```

## 🐛 Debugging

### Enable Next.js Debug Logging
```bash
DEBUG=* npm run dev
```

### Browser DevTools
- **Network tab**: Check API calls
- **Console**: Client-side errors
- **Elements**: DOM inspection

### React DevTools Extension
```bash
# Install React DevTools Chrome extension
# Helps debug component re-renders and props
```

### Server-Side Logging
```typescript
console.log('Debug info:', data)  // Appears in terminal
```

### Type Checking
```bash
npm run build  # Full TypeScript check
```

## 🧪 Testing

### Manual Testing
1. **Test authentication:**
   - Sign up → Login → Logout
   - Verify session persistence

2. **Test stock features:**
   - Search different tickers
   - Switch timeframes
   - Toggle indicators
   - Check pattern detection

3. **Test user features:**
   - Add/remove from watchlist
   - Create alerts
   - Generate analysis
   - Export reports

### API Testing with cURL
```bash
# Get stock data
curl "http://localhost:3000/api/stock/AAPL"

# Search stocks
curl "http://localhost:3000/api/search?q=apple"

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}'
```

### Using Postman
1. Download [Postman](https://www.postman.com/downloads/)
2. Create requests for each API endpoint
3. Save collection for regression testing

## 📊 Performance Optimization

### Code Splitting
- Next.js auto-splits at route level
- Dynamic imports for heavy components:
  ```typescript
  import dynamic from 'next/dynamic'
  const HeavyChart = dynamic(() => import('@/components/StockChart'), {
    loading: () => <p>Loading...</p>,
  })
  ```

### Caching
- Yahoo Finance data cached 5 minutes server-side
- Chart data cached in localStorage
- SQLite query results cached implicitly

### Database Query Optimization
```typescript
// Good - uses index
db.prepare('SELECT * FROM watchlist WHERE user_id = ?').all(userId)

// Avoid - full table scan
db.prepare('SELECT * FROM watchlist WHERE ticker LIKE ?').all('%AAPL%')
```

## 🔒 Security Best Practices

### Input Validation
```typescript
// Validate ticker format
const ticker = ticker.toUpperCase().match(/^[A-Z]{1,5}$/)?.[0]
if (!ticker) return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 })
```

### SQL Injection Prevention
```typescript
// Good - parameterized query
db.prepare('SELECT * FROM users WHERE email = ?').get(email)

// Bad - string concatenation
db.prepare(`SELECT * FROM users WHERE email = '${email}'`).get()
```

### Authentication
```typescript
// Check user before database operations
if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

## 📚 Resources

### Official Documentation
- [Next.js Docs](https://nextjs.org/docs)
- [React Docs](https://react.dev)
- [TailwindCSS Docs](https://tailwindcss.com/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Libraries
- [Lightweight Charts Docs](https://tradingview.github.io/lightweight-charts/)
- [Yahoo Finance API](https://github.com/mifi/yahoo-finance2)
- [Better SQLite3](https://github.com/JoshuaWise/better-sqlite3)
- [Bcryptjs](https://github.com/dcodeIO/bcrypt.js)

### Learning
- [Financial Technical Analysis](https://en.wikipedia.org/wiki/Technical_analysis)
- [Stock Market Basics](https://www.investopedia.com/)
- [API Design Best Practices](https://restfulapi.net/)

## 🚀 Performance Monitoring

### Lighthouse Score
```bash
npm install -g lighthouse
lighthouse http://localhost:3000 --view
```

### Bundle Analysis
```bash
npm install --save-dev @next/bundle-analyzer

# Add to next.config.js:
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

module.exports = withBundleAnalyzer({})

# Run:
ANALYZE=true npm run build
```

## 🔄 Version Control

### Useful Git Commands
```bash
# View changes
git status
git diff

# Stage and commit
git add .
git commit -m "Feature: Add description"

# Push to remote
git push origin main

# Create branch for feature
git checkout -b feature/new-feature
git push -u origin feature/new-feature

# Create pull request on GitHub
# Then merge and delete branch
```

## 📝 Code Style

### ESLint & Prettier (Optional Setup)
```bash
npm install --save-dev eslint prettier eslint-config-prettier
npx eslint --init
```

### TypeScript Strict Mode
- Already enabled in `tsconfig.json`
- Ensures type safety
- Catches errors at compile time

### Naming Conventions
- **Components**: PascalCase (`StockChart.tsx`)
- **Functions**: camelCase (`calculateSMA()`)
- **Constants**: UPPER_SNAKE_CASE (`CACHE_DURATION`)
- **Files**: kebab-case for utilities (`auth.ts`)

## 🚨 Troubleshooting

### Port 3000 Already in Use
```bash
# Use different port
PORT=3001 npm run dev

# Or kill process
# Linux/Mac:
lsof -ti:3000 | xargs kill -9

# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Module Not Found
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### TypeScript Errors
```bash
# Type check the project
npm run build

# This will show all TS errors
```

### Hot Reload Not Working
- Check browser console for errors
- Restart dev server
- Clear browser cache

### Database Locked
- Ensure only one instance running
- Delete `.db-shm` and `.db-wal` files if corrupted
- Restart development server

## 💡 Tips & Tricks

1. **VS Code Extensions:**
   - ES7+ React/Redux/React-Native snippets
   - Tailwind CSS IntelliSense
   - TypeScript Vue Plugin
   - Prettier - Code formatter

2. **Hot Reloading:**
   - Changes auto-save in dev server
   - Fast refresh for React components
   - Can lose state on file changes

3. **Environment Variables:**
   - Use `.env.local` for secrets
   - Restart dev server after changing
   - Publicly available vars must start with `NEXT_PUBLIC_`

4. **Database Inspection:**
   ```bash
   # Use DB browser (e.g., SQLite Browser)
   sqlite3 data/finance.db
   > SELECT * FROM users;
   > .schema
   ```

---

**Happy Coding! 💻**
