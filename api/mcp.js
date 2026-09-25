import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { fetchMarketData } from "../lib/marketData.js";
import { calculateCorrelation } from "../lib/correlation.js";
import { detectDeviations } from "../lib/deviations.js";
import { analyzeDivergence } from "../lib/analyzeDivergence.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null
    });
    return;
  }

  // Ensure Streamable HTTP transport receives both required media types
  req.headers.accept = "application/json, text/event-stream";

  const server = new McpServer({
    name: "alphapairs-server",
    version: "1.0.0"
  });

  // Tool 1: alphapairs_get_market_data
  server.registerTool(
    "alphapairs_get_market_data",
    {
      description: "Returns up to 20 recent daily OHLCV bars per ticker for up to 5 US equity tickers. Data is retrieved directly from the Yahoo Finance Market Data API. Use this tool when you need historical open, high, low, close, and volume series to analyze equity price movements. It does not provide real-time tick-by-tick order book depth or options chain data.",
      inputSchema: {
        tickers: z.array(z.string().min(1).max(10).toUpperCase())
          .min(1)
          .max(5)
          .describe("List of 1 to 5 US equity ticker symbols, such as ['AAPL', 'MSFT']"),
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
      description: "Returns an N x N correlation matrix of continuous logarithmic returns for up to 10 equity tickers over a specified lookback window. Data is computed from historical market prices sourced from the Yahoo Finance Market Data API. Use this tool when constructing statistical pairs or identifying cross-asset co-movement among peer candidates. It does not assess non-linear causality or lead-lag relationships between equities.",
      inputSchema: {
        tickers: z.array(z.string().min(1).max(10).toUpperCase())
          .min(2)
          .max(10)
          .describe("List of 2 to 10 US equity ticker symbols to include in the correlation matrix, such as ['GOOGL', 'META', 'MSFT']"),
        lookback_days: z.number().int().min(10).max(252).default(60)
          .describe("Lookback window in days for computing continuous log returns (between 10 and 252, default 60)")
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
      description: "Returns up to 20 residual spread tracking points and detected statistical divergence episodes where a target ticker deviates from its peer group benchmark. Data is calculated via ordinary least squares regression from price series retrieved from the Yahoo Finance Market Data API. Use this tool to identify abnormal valuation dislocations and mean-reversion opportunities based on Z-score thresholds. It does not forecast future price direction or generate automated trade execution orders.",
      inputSchema: {
        target: z.string().min(1).max(10).toUpperCase()
          .describe("Target US equity ticker symbol to monitor for deviation, e.g. 'NVDA'"),
        peers: z.array(z.string().min(1).max(10).toUpperCase())
          .min(1)
          .max(10)
          .describe("List of 1 to 10 peer equity ticker symbols forming the benchmark basket, e.g. ['AMD', 'INTC', 'TSM']"),
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
              text: `AlphaPairs deviation detection failed with status ${status}: ${error.message.replace(/[\r\n]+/g, " ")}.`
            }
          ]
        };
      }
    }
  );

  // Tool 4: alphapairs_analyze_divergence
  server.registerTool(
    "alphapairs_analyze_divergence",
    {
      description: "Returns an institutional-grade quantitative research memo examining the corporate catalysts, earnings drivers, and mean-reversion factors behind a detected pair dislocation. Analysis is generated using the Google Gemini 3.8 Flash model via the Gemini API. Use this tool when you require deep fundamental and macro synthesis explaining why a target stock decoupled from its peer group. It does not provide personalized investment advice, guaranteed profit targets, or broker order routing.",
      inputSchema: {
        ticker: z.string().min(1).max(10).toUpperCase()
          .describe("Target equity ticker symbol that experienced statistical divergence, e.g. 'NVDA'"),
        peer_group_name: z.string().min(1).max(50)
          .describe("Descriptive name of the sector or peer group benchmark, e.g. 'Semiconductors'"),
        peer_tickers: z.array(z.string().min(1).max(10).toUpperCase())
          .min(1)
          .max(10)
          .describe("Array of peer ticker symbols in the comparison basket, e.g. ['AMD', 'INTC', 'TSM']"),
        max_z_score: z.number()
          .describe("Peak standard deviation dislocation reached during the episode, e.g. 2.75"),
        peak_spread_pct: z.number()
          .describe("Maximum percentage spread deviation observed between target and benchmark, e.g. 11.4"),
        direction: z.string()
          .describe("Direction of the dislocation: 'divergence_above' or 'above' if target outperformed peers, or 'divergence_below' or 'below' if underperformed"),
        duration_days: z.number().int().min(1).max(365)
          .describe("Total duration in days of the divergence episode, e.g. 18"),
        start_date: z.string()
          .describe("ISO start date (YYYY-MM-DD) when the spread crossed the statistical threshold"),
        peak_date: z.string()
          .describe("ISO date (YYYY-MM-DD) when the spread reached maximum Z-score divergence"),
        collapse_date: z.string().nullable().optional()
          .describe("ISO date (YYYY-MM-DD) when the spread collapsed back to historical mean, or null if still unresolved")
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
              text: `Google Gemini API analysis failed with status ${status}: ${error.message.replace(/[\r\n]+/g, " ")}.`
            }
          ]
        };
      }
    }
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
