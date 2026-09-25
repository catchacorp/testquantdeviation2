import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { fetchMarketData } from "../lib/marketData.js";
import { calculateCorrelation } from "../lib/correlation.js";
import { detectDeviations, getCompanyProfile } from "../lib/deviations.js";
import { analyzeDivergence } from "../lib/analyzeDivergence.js";

export default async function handler(req, res) {
  // Global CORS headers for cross-origin MCP client access
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, Mcp-Session-Id, x-api-key");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Handle GET / HEAD: Server discovery, health inspection & browser navigation
  if (req.method === "GET" || req.method === "HEAD") {
    // If client specifically requests text/event-stream for SSE streaming
    if (req.headers.accept?.includes("text/event-stream")) {
      try {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true
        });
        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      } catch (err) {
        // Fall back to health JSON
      }
    }

    res.status(200).json({
      status: "healthy",
      name: "alphapairs-server",
      version: "1.0.0",
      protocol: "mcp-streamable-http",
      protocolVersion: "2025-11-25",
      description: "Production Model Context Protocol (MCP) Server for AlphaPairs Quantitative Statistical Arbitrage & Equities Deviation Engine",
      upstream: {
        market_data: "Yahoo Finance Live Market Data API (dual query1/query2 failover)",
        ai_engine: "Google Gemini 3.8 Flash API"
      },
      instructions: "To execute MCP tools or inspect capabilities, send HTTP POST requests with a JSON-RPC 2.0 payload to this endpoint.",
      example_post_request: {
        jsonrpc: "2.0",
        id: "sample-1",
        method: "tools/list",
        params: {}
      },
      tools: [
        {
          name: "alphapairs_get_market_data",
          description: "Returns up to 20 recent daily OHLCV bars per ticker for up to 20 US equity tickers from Yahoo Finance."
        },
        {
          name: "alphapairs_calculate_correlation",
          description: "Returns an N x N correlation matrix of continuous logarithmic returns for up to 15 equity tickers."
        },
        {
          name: "alphapairs_detect_deviations",
          description: "Returns residual spread tracking points, 20-day moving averages, and statistical divergence episodes for target vs peer basket."
        },
        {
          name: "alphapairs_get_ticker_profile",
          description: "Returns dynamic verified live company profile, name, sector, industry, and live price for any US equity ticker."
        },
        {
          name: "alphapairs_analyze_divergence",
          description: "Returns an institutional-grade quantitative research memo examining corporate catalysts and mean reversion via Gemini API."
        }
      ]
    });
    return;
  }

  // Reject unsupported HTTP verbs
  if (req.method !== "POST") {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: `Method ${req.method} not allowed. Send POST with JSON-RPC 2.0 payload.` },
      id: null
    });
    return;
  }

  // Parse body if received as string or buffer
  let parsedBody = req.body;
  if (typeof parsedBody === "string") {
    try {
      parsedBody = JSON.parse(parsedBody);
    } catch {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error: Request body must be valid JSON" },
        id: null
      });
      return;
    }
  }

  // Ensure Streamable HTTP transport receives both required media types
  req.headers.accept = "application/json, text/event-stream";

  const server = createMcpServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}

function createMcpServer() {
  const server = new McpServer({
    name: "alphapairs-server",
    version: "1.0.0"
  });

  // Tool 1: alphapairs_get_market_data
  server.registerTool(
    "alphapairs_get_market_data",
    {
      description: "Returns up to 20 recent daily OHLCV bars per ticker for up to 20 US equity tickers. Data is retrieved directly from the Yahoo Finance Market Data API. Use this tool when you need historical open, high, low, close, and volume series to analyze equity price movements. It does not provide real-time tick-by-tick order book depth or options chain data.",
      inputSchema: {
        tickers: z.array(z.string().min(1).max(10).toUpperCase())
          .min(1)
          .max(20)
          .describe("List of 1 to 20 US equity ticker symbols, such as ['AAPL', 'NVDA', 'VRT']"),
        lookback_days: z.number().int().min(5).max(120).default(30)
          .describe("Number of calendar days of historical OHLCV data to retrieve (between 5 and 120, default 30)")
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) => {
      try {
        const result = await fetchMarketData(args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        const status = error.status || error.statusCode || 500;
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Yahoo Finance Market Data API request failed with status ${status}: ${error.message.replace(/[\r\n]+/g, " ")}.`
            }
          ]
        };
      }
    }
  );

  // Tool 2: alphapairs_calculate_correlation
  server.registerTool(
    "alphapairs_calculate_correlation",
    {
      description: "Returns an N x N correlation matrix of continuous logarithmic returns for up to 15 equity tickers over a specified lookback window. Data is computed from historical market prices sourced from the Yahoo Finance Market Data API. Use this tool when constructing statistical pairs or identifying cross-asset co-movement among peer candidates. It does not assess non-linear causality or lead-lag relationships between equities.",
      inputSchema: {
        tickers: z.array(z.string().min(1).max(10).toUpperCase())
          .min(2)
          .max(15)
          .describe("List of 2 to 15 US equity ticker symbols to calculate pairwise correlation for"),
        lookback_days: z.number().int().min(10).max(252).default(60)
          .describe("Historical lookback window in calendar days (between 10 and 252, default 60)")
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) => {
      try {
        const result = await calculateCorrelation(args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        const status = error.status || error.statusCode || 500;
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Yahoo Finance correlation calculation failed with status ${status}: ${error.message.replace(/[\r\n]+/g, " ")}.`
            }
          ]
        };
      }
    }
  );

  // Tool 3: alphapairs_detect_deviations
  server.registerTool(
    "alphapairs_detect_deviations",
    {
      description: "Returns up to 20 residual spread tracking points, 20-day moving averages, and detected statistical divergence episodes where a target ticker deviates from its peer group benchmark. Data is calculated via ordinary least squares regression from price series retrieved from the Yahoo Finance Market Data API. Use this tool to identify abnormal valuation dislocations and mean-reversion opportunities based on Z-score thresholds. It does not forecast future price direction or generate automated trade execution orders.",
      inputSchema: {
        target: z.string().min(1).max(10).toUpperCase()
          .describe("Target US equity ticker symbol to monitor for deviation, e.g. 'NVDA' or 'VRT'"),
        peers: z.array(z.string().min(1).max(10).toUpperCase())
          .min(1)
          .max(25)
          .describe("List of 1 to 25 peer equity ticker symbols forming the benchmark basket, e.g. ['AMD', 'INTC', 'TSM', 'VRT']"),
        z_threshold: z.number().min(1.0).max(4.0).default(2.0)
          .describe("Standard deviation threshold (Z-score) for flagging statistical divergence episodes (between 1.0 and 4.0, default 2.0)"),
        lookback_days: z.number().int().min(15).max(180).default(60)
          .describe("Historical lookback window in calendar days for OLS benchmark estimation and rolling spread computation (between 15 and 180, default 60)")
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) => {
      try {
        const result = await detectDeviations(args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        const status = error.status || error.statusCode || 500;
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Yahoo Finance deviation detection failed with status ${status}: ${error.message.replace(/[\r\n]+/g, " ")}.`
            }
          ]
        };
      }
    }
  );

  // Tool 4: alphapairs_get_ticker_profile
  server.registerTool(
    "alphapairs_get_ticker_profile",
    {
      description: "Returns dynamic verified live company profile, name, sector, industry, live market price, and exchange for any US equity ticker directly from Yahoo Finance.",
      inputSchema: {
        ticker: z.string().min(1).max(10).toUpperCase()
          .describe("Stock ticker symbol to inspect, e.g. 'VRT', 'NVDA', 'PLTR'")
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ ticker }) => {
      try {
        const result = await getCompanyProfile(ticker);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        const status = error.status || error.statusCode || 500;
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Yahoo Finance ticker profile failed with status ${status}: ${error.message.replace(/[\r\n]+/g, " ")}.`
            }
          ]
        };
      }
    }
  );

  // Tool 5: alphapairs_analyze_divergence
  server.registerTool(
    "alphapairs_analyze_divergence",
    {
      description: "Returns an institutional-grade quantitative research memo examining the corporate catalysts, earnings drivers, and mean-reversion factors behind a detected pair dislocation. Analysis is generated using the Google Gemini 3.8 Flash model via the Gemini API. Use this tool when you require deep fundamental and macro synthesis explaining why a target stock decoupled from its peer group. It does not provide personalized investment advice, guaranteed profit targets, or broker order routing.",
      inputSchema: {
        ticker: z.string().min(1).max(10).toUpperCase()
          .describe("Ticker of the equity that experienced statistical divergence (e.g. 'NVDA' or 'VRT')"),
        peer_group_name: z.string().min(1).max(80)
          .describe("Descriptive name of the comparison peer cohort, e.g. 'Data Center Infrastructure'"),
        peer_tickers: z.array(z.string().min(1).max(10).toUpperCase())
          .min(1)
          .max(20)
          .describe("Array of ticker symbols in the peer basket"),
        max_z_score: z.number()
          .describe("Peak Z-score observed during the deviation episode"),
        peak_spread_pct: z.number()
          .describe("Maximum percentage spread deviation relative to the fitted regression benchmark"),
        direction: z.enum(["divergence_above", "divergence_below"])
          .describe("Direction of divergence: 'divergence_above' or 'divergence_below'"),
        duration_days: z.number().int().min(1)
          .describe("Total calendar duration of the dislocation episode in days"),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Start date of the deviation episode in YYYY-MM-DD format"),
        peak_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Date of maximum dislocation in YYYY-MM-DD format"),
        collapse_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
          .describe("Date when spread collapsed back to peer group in YYYY-MM-DD format, or null if active")
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) => {
      try {
        const result = await analyzeDivergence(args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        const status = error.status || error.statusCode || 500;
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Gemini Divergence Memo generation failed with status ${status}: ${error.message.replace(/[\r\n]+/g, " ")}.`
            }
          ]
        };
      }
    }
  );

  return server;
}
