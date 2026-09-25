# AlphaPairs — Project Prompts & Development Log

This document collates all user prompts, specifications, bug reports, and architectural directives across the evolution of the **AlphaPairs Quantitative Deviation Engine & Model Context Protocol (MCP) Server**.

---

## Table of Contents
1. [Prompt 1: Initial System Architecture & MCP Engine](#prompt-1-initial-system-architecture--mcp-engine)
2. [Prompt 2: Layout & Quantitative Feature Enhancements](#prompt-2-layout--quantitative-feature-enhancements)
3. [Prompt 3: Dynamic Live Price & MCP Data Fetching for New Tickers (VRT)](#prompt-3-dynamic-live-price--mcp-data-fetching-for-new-tickers-vrt)
4. [Prompt 4: DOM Nesting & Hydration Error Fix (GrandmaTooltip)](#prompt-4-dom-nesting--hydration-error-fix-grandmatooltip)
5. [Prompt 5: MCP Endpoint 405 "Method Not Allowed" Fix on Vercel](#prompt-5-mcp-endpoint-405-method-not-allowed-fix-on-vercel)
6. [Prompt 6: Collation of All Prompts](#prompt-6-collation-of-all-prompts)
7. [MCP Tool Specifications Reference](#mcp-tool-specifications-reference)

---

## Prompt 1: Initial System Architecture & MCP Engine

### User Request / Core Objective
> Build a production-grade quantitative statistical arbitrage application that identifies mean-reversion divergence episodes between a target US equity and a peer benchmark basket. Expose the entire analytical and market-data suite as a Model Context Protocol (MCP) Streamable HTTP Server at `/api/mcp` for consumption by external autonomous AI agents, accompanied by an interactive quantitative dashboard.

### Key Requirements
- **Live Market Data Pipeline**: Retrieve real-time and historical daily OHLCV prices from Yahoo Finance with automated dual-endpoint failover (`query1.finance.yahoo.com` and `query2.finance.yahoo.com`).
- **Statistical Arbitrage Model**:
  - Continuous logarithmic return transformation.
  - Ordinary Least Squares (OLS) regression: $Y = \alpha + \beta X + \epsilon$.
  - Rolling residual spread calculation with dynamic Z-score standard deviation thresholds ($1.0\sigma - 4.0\sigma$).
  - Divergence episode tracking (peak dislocation, spread %, duration, collapse date).
- **Model Context Protocol (MCP) Server**:
  - Mount at `/api/mcp` using `@modelcontextprotocol/sdk` and `StreamableHTTPServerTransport`.
  - JSON-RPC 2.0 protocol compliance.
  - Implement core tools: `alphapairs_get_market_data`, `alphapairs_calculate_correlation`, `alphapairs_detect_deviations`, and `alphapairs_analyze_divergence` (powered by Google Gemini 3.8 Flash).
- **Deployment**: Full-stack Vercel serverless functions (`/api/*`) and Vite React frontend on GitHub repository `https://github.com/catchacorp/testquantdeviation2.git`.

---

## Prompt 2: Layout & Quantitative Feature Enhancements

### User Request / Core Objective
> Enhance the application with:
> 1. An expanded default universe of 11 equities: `NVDA`, `META`, `AMZN`, `AAPL`, `NFLX`, `GOOGL`, `MSFT`, `TSLA`, `AMD`, `AVGO`, `MU`.
> 2. A 50/50 horizontal split for the top row: the left 50% must be a prominently highlighted Target Equity card (taking at least half the row in large font), and the right 50% must contain the Peer Basket controls.
> 3. A dedicated "Right Now" section placed directly below the basket row to identify present-time surge or lag vs 20-day moving average and relative peer return, flagging "Potential Buy" (discount) vs "Potential Short Sell" (stretched).
> 4. A "Historical Deviation" log with explicit dates: Start Date, Peak Dislocation Date, Peak Spread %, Peak Z-score, Collapse Date (mean-reversion date), and both Internal (company-specific) and External (macro/sector) rationales.
> 5. A "Why These Peers?" tab detailing commercial and supply chain interdependencies (e.g., NVDA GPUs, MU HBM memory, VRT liquid cooling & power, AVGO ASICs, hyperscalers).
> 6. Grandmother-friendly tooltips ("Grandma tooltips") explaining every quant term in plain, easy language with a friendly popover.
> 7. Clustered top toggles (Dark/Light mode toggle, clickable MCP status badge `/api/mcp`, copy URL button) to prevent visual clutter.
> 8. Light and Dark mode support throughout the application.

### Delivered Solutions
- **50/50 Layout**: Built responsive grid (`grid-cols-1 lg:grid-cols-2`) with a hero Target Equity card featuring 5xl/6xl typography, live quote, 20-day SMA, OLS Beta, R², and one-click target switcher.
- **"Right Now" Real-Time Signal Matrix**: Computes 5-day return divergence and 20-day SMA deviations to classify stocks into:
  - `POTENTIAL BUY` (Significant Lag / Oversold $\le -2.5\%$)
  - `POTENTIAL SHORT SELL` (Significant Surge / Overbought $\ge +2.5\%$)
  - `NEUTRAL / HOLD` (In-sync trading)
- **Historical Deviation Dates Log**: Tracks episodes with discrete timestamps (`start_date`, `peak_date`, `collapse_date`), peak Z-scores, peak spread %, and generated internal vs external rationales.
- **Grandma Tooltips**: Added accessible `?` popovers explaining Beta, Z-Score, Residual Spread, Moving Averages, and Mean Reversion in everyday analogies.
- **Clustered Controls & Light/Dark Theme**: Grouped MCP status badge, Dark/Light mode toggle, and URL copy buttons into the header navigation bar.

---

## Prompt 3: Dynamic Live Price & MCP Data Fetching for New Tickers (VRT)

### User Request / Bug Report
> When I added a new ticker, it is not providing the live price. Eg VRT price and description is fabricated and not pulling data from the MCP. Fix this.

### Root Cause Analysis
1. **Basket Peer Limit Truncation**: Both `lib/deviations.js` and `api/mcp.js` previously sliced peer inputs at 10 items (`.slice(0, 10)` and Zod `z.array().max(10)`). Because the default basket already contained 10 peers, any 11th custom ticker (such as `VRT`) was dropped prior to execution.
2. **Static Dictionary Dependency**: Company descriptions and sector data relied on a static dictionary. Unknown symbols defaulted to generic placeholders.
3. **Multi-Exchange Date Alignment**: Different trading calendars between NASDAQ and NYSE equities led to dropped dates on strict intersections.

### Delivered Solutions
- **Expanded Capacity**: Increased peer basket capacity from 10 to **25 tickers** across schemas, server functions, and client UI.
- **Dynamic Profile Resolver**: Added `getCompanyProfile(ticker)` and registered a new MCP tool:
  - **`alphapairs_get_ticker_profile`**: Fetches verified company name (`Vertiv Holdings Co`), exchange (`NYSE`), sector (`Industrials`), industry (`Electrical Equipment & Parts`), and live market price (`$245.30`) directly from Yahoo Finance.
- **Forward-Fill Date Alignment**: Forward-fills missing historical bars across exchanges to prevent dropped sessions.
- **Instant UI Telemetry**: Displays feedback banner when adding tickers (`✓ Added VRT (Vertiv Holdings Co): Live $245.30 on NYSE`).

---

## Prompt 4: DOM Nesting & Hydration Error Fix (GrandmaTooltip)

### User Request / Bug Report
> Fix the errors in the app
> ```text
> [AIS_METADATA_SECTION_START]
> fix_it_trigger: manual
> error 0: In HTML, %s cannot be a descendant of <%s>.
> This will cause a hydration error.%s <button> button 
>   <App>
>     ...
>     <button className="...">
>       <GrandmaTooltip ...>
>         <button ... aria-label="Explain Target & Basket">
> ```

### Root Cause Analysis
- The navigation tabs were implemented as HTML `<button>` elements containing `<GrandmaTooltip>`.
- `<GrandmaTooltip>` internally rendered its `?` trigger icon as `<button type="button">`.
- Per HTML specifications and React DOM rules, `<button>` elements cannot be descendants of another `<button>`.

### Delivered Solutions
- Refactored `<GrandmaTooltip>` trigger element to `<span role="button" tabIndex={0} ...>` with `e.stopPropagation()` and keyboard support (`Enter` / `Space`).
- Confirmed zero nested `<button>` violations across the entire component tree.

---

## Prompt 5: MCP Endpoint 405 "Method Not Allowed" Fix on Vercel

### User Request / Bug Report
> ```json
> {
>   "jsonrpc": "2.0",
>   "error": {
>     "code": -32000,
>     "message": "Method not allowed"
>   },
>   "id": null
> }
> ```
> I am getting an error at https://testquantdeviation2.vercel.app/api/mcp
> Fix this.

### Root Cause Analysis
- The `/api/mcp` endpoint is a Model Context Protocol Streamable HTTP server expecting JSON-RPC 2.0 `POST` requests.
- When visited via a web browser, automated uptime monitor, or curl without `-X POST`, the browser sends an HTTP `GET` request.
- The handler strictly checked `if (req.method !== "POST") res.status(405)...`, returning `405 Method not allowed`.

### Delivered Solutions
- **Added HTTP `GET` & `HEAD` Discovery Endpoint**: Visiting `/api/mcp` in a browser now returns a **200 OK JSON discovery document** containing server health, protocol versions, instructions, and schemas for all 5 registered tools.
- **CORS `OPTIONS` Preflight Support**: Returns `204 No Content` with `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Methods: GET, POST, OPTIONS, HEAD` with 24-hour cache.
- **Server-Sent Events (SSE)**: Supports streaming if `Accept: text/event-stream` is requested on `GET`.
- **JSON-RPC 2.0 on `POST`**: Preserved complete compatibility for MCP clients calling `tools/list` and `tools/call`.

---

## Prompt 6: Collation of All Prompts

### User Request
> Collate all the prompts into prompt.md file and include it in the code base.

### Delivered Solution
- Created this comprehensive `prompt.md` document detailing every user request, rationale, technical specification, bug fix, and MCP API schema in the repository root.

---

## MCP Tool Specifications Reference

The `/api/mcp` endpoint exposes 5 tools via JSON-RPC 2.0:

| Tool Name | Method | Description | Upstream |
| :--- | :--- | :--- | :--- |
| `alphapairs_get_market_data` | `tools/call` | Returns up to 20 daily OHLCV bars per ticker (up to 20 tickers). | Yahoo Finance |
| `alphapairs_calculate_correlation` | `tools/call` | Returns an $N \times N$ correlation matrix of continuous log returns (up to 15 tickers). | Yahoo Finance |
| `alphapairs_detect_deviations` | `tools/call` | Computes OLS regression benchmark, rolling Z-score residuals, 20-day SMA, and detects divergence episodes (up to 25 peer tickers). | Yahoo Finance |
| `alphapairs_get_ticker_profile` | `tools/call` | Fetches verified company name, exchange, sector, industry, and live price for any ticker. | Yahoo Finance |
| `alphapairs_analyze_divergence` | `tools/call` | Synthesizes an institutional-grade fundamental and macro research memo explaining a divergence episode. | Google Gemini 3.8 Flash |
