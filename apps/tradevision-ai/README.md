# TradeVision AI

**Bloomberg Terminal meets modern fintech** — an AI-powered stock tracker for retail investors.

## Features

- **Real-time Dashboard** — S&P 500, NASDAQ, DOW, FTSE 100 cards with sparklines, scrolling ticker marquee, sector heatmap
- **AI Buy/Sell Signals** — Claude claude-sonnet-4-6 analyzes price data, fundamentals, and technicals to generate STRONG BUY / BUY / HOLD / SELL / STRONG SELL signals with confidence scores and reasoning
- **AI Market Pulse** — Sentiment gauge (0–100) with AI-generated market summary, bullish/bearish factors
- **Interactive Charts** — Candlestick, line, and area charts with multi-timeframe support (1D–MAX) via TradingView's lightweight-charts
- **AI News Feed** — Market news with AI sentiment analysis (Bullish/Bearish/Neutral) and AI-generated summaries
- **Watchlist** — Drag-and-drop with live prices, AI signal badges, sparklines. Persisted in localStorage
- **Portfolio Tracker** — Add holdings with shares + buy price, track P&L, allocation donut chart, 30-day performance chart
- **AI Chat** — Claude-powered streaming chat assistant for market analysis and investment Q&A

## Tech Stack

- **Framework**: Next.js 14 App Router with TypeScript strict mode
- **Styling**: Tailwind CSS + custom design system (dark theme, glass-morphism, glow effects)
- **Charts**: lightweight-charts (TradingView) + Recharts
- **Animations**: Framer Motion + CSS custom animations
- **AI**: Anthropic Claude claude-sonnet-4-6 (signals, pulse, chat)
- **Data**: Alpha Vantage (quotes, candles), Finnhub (news), with comprehensive mock data fallbacks
- **Icons**: Lucide React

## Setup

### 1. Install dependencies

```bash
cd apps/tradevision-ai
npm install
# or: pnpm install | yarn install | bun install
```

### 2. Configure API keys

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
# Required for AI features
ANTHROPIC_API_KEY=sk-ant-...

# Optional — app works with mock data without these
ALPHA_VANTAGE_API_KEY=your_key   # https://www.alphavantage.co/support/#api-key
FINNHUB_API_KEY=your_key         # https://finnhub.io/register
```

> **Without API keys**: The app runs fully with rich mock data — all UI, charts, and layouts work perfectly. Only live price data, real news, and the AI chat/signals require API keys.

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API Keys

| Key | Where to Get | Free Tier | Purpose |
|-----|-------------|-----------|---------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) | Pay-per-use | AI signals, market pulse, chat |
| `ALPHA_VANTAGE_API_KEY` | [alphavantage.co](https://www.alphavantage.co/support/#api-key) | 25 req/day | Real-time stock quotes |
| `FINNHUB_API_KEY` | [finnhub.io](https://finnhub.io/register) | 60 req/min | Market news feed |

## Project Structure

```
apps/tradevision-ai/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Dashboard
│   ├── stocks/[ticker]/        # Stock detail page
│   ├── news/                   # AI news feed
│   ├── watchlist/              # Watchlist manager
│   ├── portfolio/              # Portfolio tracker
│   └── api/                    # API routes
│       ├── chat/               # Streaming AI chat
│       ├── ai-signal/          # AI signal generation
│       ├── stock/[ticker]/     # Stock quotes + candles
│       ├── news/               # News feed
│       ├── search/             # Symbol search
│       └── market-data/        # Index + mover data
├── components/
│   ├── layout/                 # Sidebar, TopBar, AppLayout
│   ├── dashboard/              # IndexCard, TickerMarquee, SectorHeatmap, etc.
│   ├── stocks/                 # StockChart, AISignalCard, StatsGrid, etc.
│   ├── news/                   # NewsCard, NewsFeed
│   ├── watchlist/              # WatchlistToggle
│   ├── portfolio/              # Charts and holding rows
│   ├── chat/                   # ChatPanel, ChatButton
│   └── common/                 # SignalBadge, SparklineChart, PriceDisplay, Skeletons
├── lib/
│   ├── types.ts                # All TypeScript interfaces
│   ├── utils.ts                # Formatting, color, market helpers
│   ├── mock-data.ts            # Rich mock data (works without API keys)
│   ├── cache.ts                # In-memory TTL cache
│   ├── alpha-vantage.ts        # Alpha Vantage API client
│   ├── finnhub.ts              # Finnhub API client
│   └── anthropic.ts            # Claude AI client
└── hooks/                      # Custom React hooks
```

## Design System

- **Background**: `#09090B` (near-black)
- **Cards**: `#111113` with 1px `#1E1E22` borders
- **Gain**: `#00FF88` (neon green) with glow
- **Loss**: `#FF3B5C` (vibrant red) with glow
- **Interactive**: `#3B82F6` (electric blue)
- **Warning/Hold**: `#F59E0B` (amber)
- **Typography**: JetBrains Mono for all numbers/prices (tabular-nums)
- **Effects**: Glass-morphism cards, backdrop-blur, gradient borders, noise texture

## Screenshots

> Add screenshots here after first run

## Disclaimer

TradeVision AI provides AI-generated market analysis for educational and informational purposes only. Nothing on this platform constitutes financial advice. Always do your own research and consult a qualified financial advisor before making investment decisions.
