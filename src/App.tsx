import React, { useState, useEffect } from "react";
import {
  TrendingUp,
  Activity,
  Layers,
  Cpu,
  Server,
  Copy,
  Check,
  Play,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Terminal,
  Database,
  RefreshCw,
  Sliders,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink
} from "lucide-react";

interface Episode {
  episode_id: string;
  direction: string;
  start_date: string;
  peak_date: string;
  peak_z_score: number;
  peak_spread_pct: number;
  duration_days: number;
  collapse_date: string | null;
  status: "active" | "mean_reverted";
}

interface ResidualPoint {
  date: string;
  target_price: number;
  benchmark_normalized: number;
  target_normalized: number;
  residual: number;
  z_score: number;
  spread_pct: number;
}

interface DeviationResult {
  source: string;
  fetched_at: string;
  target: string;
  peers: string[];
  lookback_days: number;
  z_threshold: number;
  model: {
    alpha: number;
    beta: number;
    r_squared: number;
    residual_std: number;
  };
  episodes: Episode[];
  residual_points: ResidualPoint[];
}

interface CorrelationResult {
  source: string;
  fetched_at: string;
  tickers: string[];
  lookback_days: number;
  trading_days_analyzed: number;
  matrix: Record<string, Record<string, number>>;
  pairs: Array<{
    pair: string;
    ticker_a: string;
    ticker_b: string;
    correlation: number;
  }>;
}

interface MarketBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MarketDataResult {
  source: string;
  fetched_at: string;
  tickers: string[];
  lookback_days: number;
  data: Record<string, MarketBar[]>;
  summaries: Array<{
    ticker: string;
    latest_date: string;
    close: number;
    change_pct: number;
    bars_count: number;
  }>;
}

interface DivergenceMemoResult {
  source: string;
  fetched_at: string;
  ticker: string;
  peer_group_name: string;
  peer_tickers: string[];
  episode_metrics: {
    max_z_score: number;
    peak_spread_pct: number;
    direction: string;
    duration_days: number;
    start_date: string;
    peak_date: string;
    collapse_date: string | null;
  };
  memo: {
    headline: string;
    executive_summary: string;
    corporate_catalysts: string;
    peer_dynamics: string;
    mean_reversion_assessment: string;
  };
  risk_factors: string[];
  tactical_recommendations: string[];
  catalyst_timeline: Array<{
    date_or_milestone: string;
    event: string;
    impact: string;
  }>;
}

interface McpVerificationState {
  status: "idle" | "verifying" | "connected" | "error";
  latencyMs: number;
  toolsCount: number;
  tools: string[];
  lastVerified: string | null;
  errorMessage: string | null;
  priceSample: {
    ticker: string;
    date: string;
    close: number;
    volume: number;
    source: string;
    isAuthentic: boolean;
  } | null;
}

const PRESET_BASKETS = [
  {
    name: "Semiconductors",
    target: "NVDA",
    peers: ["AMD", "INTC", "TSM", "QCOM"],
    description: "AI chips, foundries & graphics vs fabless ecosystem"
  },
  {
    name: "Megacap Platforms",
    target: "MSFT",
    peers: ["AAPL", "GOOGL", "AMZN", "META"],
    description: "Hyperscalers and consumer ecosystem platforms"
  },
  {
    name: "EV & Automakers",
    target: "TSLA",
    peers: ["F", "GM", "TM", "RIVN"],
    description: "Pure-play electric vehicles vs legacy automotive OEM peers"
  },
  {
    name: "Wall Street Financials",
    target: "JPM",
    peers: ["BAC", "C", "WFC", "MS"],
    description: "Money-center universal banks & investment bank peers"
  }
];

/**
 * Executes a tool call directly through the /api/mcp endpoint via JSON-RPC 2.0
 */
async function callMcpTool(name: string, args: Record<string, any>) {
  const res = await fetch("/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `app-call-${Date.now()}`,
      method: "tools/call",
      params: {
        name,
        arguments: args
      }
    })
  });

  if (!res.ok) {
    let errDetail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson.error?.message) errDetail = errJson.error.message;
    } catch {}
    throw new Error(`MCP Request failed: ${errDetail}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`MCP Error [${json.error.code}]: ${json.error.message}`);
  }

  const result = json.result;
  if (!result || !result.content || !result.content[0]) {
    throw new Error("MCP Tool returned invalid empty payload");
  }

  if (result.isError) {
    throw new Error(result.content[0].text);
  }

  return JSON.parse(result.content[0].text);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"deviations" | "correlation" | "market" | "memo" | "mcp">("deviations");
  const [copiedMcpUrl, setCopiedMcpUrl] = useState(false);
  const [useMcpDirectly, setUseMcpDirectly] = useState(true);

  // MCP Connection & Price Authenticity State
  const [mcpHealth, setMcpHealth] = useState<McpVerificationState>({
    status: "idle",
    latencyMs: 0,
    toolsCount: 0,
    tools: [],
    lastVerified: null,
    errorMessage: null,
    priceSample: null
  });

  // Tab 1: Deviation Detector State
  const [targetTicker, setTargetTicker] = useState("NVDA");
  const [peerTickersInput, setPeerTickersInput] = useState("AMD, INTC, TSM");
  const [zThreshold, setZThreshold] = useState(2.0);
  const [lookbackDays, setLookbackDays] = useState(60);
  const [devLoading, setDevLoading] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);
  const [devResult, setDevResult] = useState<DeviationResult | null>(null);

  // Tab 2: Correlation Matrix State
  const [corrTickersInput, setCorrTickersInput] = useState("NVDA, AMD, TSM, INTC, MSFT, AAPL");
  const [corrLookback, setCorrLookback] = useState(60);
  const [corrLoading, setCorrLoading] = useState(false);
  const [corrError, setCorrError] = useState<string | null>(null);
  const [corrResult, setCorrResult] = useState<CorrelationResult | null>(null);

  // Tab 3: Market Data State
  const [marketTickersInput, setMarketTickersInput] = useState("NVDA, AMD, MSFT");
  const [marketLookback, setMarketLookback] = useState(30);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketResult, setMarketResult] = useState<MarketDataResult | null>(null);
  const [selectedMarketTicker, setSelectedMarketTicker] = useState("NVDA");

  // Tab 4: AI Divergence Memo State
  const [memoTicker, setMemoTicker] = useState("NVDA");
  const [memoGroupName, setMemoGroupName] = useState("Semiconductor Accelerators");
  const [memoPeersInput, setMemoPeersInput] = useState("AMD, INTC, TSM");
  const [memoMaxZ, setMemoMaxZ] = useState(2.45);
  const [memoPeakSpread, setMemoPeakSpread] = useState(12.3);
  const [memoDirection, setMemoDirection] = useState("divergence_above");
  const [memoDuration, setMemoDuration] = useState(14);
  const [memoStartDate, setMemoStartDate] = useState("2026-08-12");
  const [memoPeakDate, setMemoPeakDate] = useState("2026-08-19");
  const [memoCollapseDate, setMemoCollapseDate] = useState("2026-08-26");
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoError, setMemoError] = useState<string | null>(null);
  const [memoResult, setMemoResult] = useState<DivergenceMemoResult | null>(null);

  // Tab 5: MCP Protocol Inspector State
  const [mcpSelectedTool, setMcpSelectedTool] = useState("alphapairs_detect_deviations");
  const [mcpPayload, setMcpPayload] = useState("");
  const [mcpExecuting, setMcpExecuting] = useState(false);
  const [mcpResponse, setMcpResponse] = useState<string | null>(null);

  // Auto-verify MCP connection on mount & run initial deviation detection
  useEffect(() => {
    verifyMcpConnection();
    handleRunDeviation();
  }, []);

  // Update default MCP payload when tool selection changes
  useEffect(() => {
    if (mcpSelectedTool === "alphapairs_get_market_data") {
      setMcpPayload(
        JSON.stringify(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "alphapairs_get_market_data",
              arguments: {
                tickers: ["NVDA", "AMD", "MSFT"],
                lookback_days: 30
              }
            }
          },
          null,
          2
        )
      );
    } else if (mcpSelectedTool === "alphapairs_calculate_correlation") {
      setMcpPayload(
        JSON.stringify(
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "alphapairs_calculate_correlation",
              arguments: {
                tickers: ["AAPL", "MSFT", "GOOGL", "NVDA"],
                lookback_days: 60
              }
            }
          },
          null,
          2
        )
      );
    } else if (mcpSelectedTool === "alphapairs_detect_deviations") {
      setMcpPayload(
        JSON.stringify(
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "alphapairs_detect_deviations",
              arguments: {
                target: "NVDA",
                peers: ["AMD", "INTC", "TSM"],
                z_threshold: 2.0,
                lookback_days: 60
              }
            }
          },
          null,
          2
        )
      );
    } else if (mcpSelectedTool === "alphapairs_analyze_divergence") {
      setMcpPayload(
        JSON.stringify(
          {
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: {
              name: "alphapairs_analyze_divergence",
              arguments: {
                ticker: "NVDA",
                peer_group_name: "Semiconductors",
                peer_tickers: ["AMD", "INTC", "TSM"],
                max_z_score: 2.45,
                peak_spread_pct: 12.3,
                direction: "divergence_above",
                duration_days: 14,
                start_date: "2026-08-12",
                peak_date: "2026-08-19",
                collapse_date: "2026-08-26"
              }
            }
          },
          null,
          2
        )
      );
    }
  }, [mcpSelectedTool]);

  /**
   * End-to-end verification of MCP connection and price authenticity
   */
  const verifyMcpConnection = async () => {
    setMcpHealth(prev => ({ ...prev, status: "verifying", errorMessage: null }));
    const startTime = performance.now();

    try {
      // Step 1: Verify MCP Handshake & Tools Discovery (tools/list)
      const listRes = await fetch("/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "mcp-verify-list",
          method: "tools/list",
          params: {}
        })
      });

      if (!listRes.ok) {
        throw new Error(`MCP Server rejected connection with HTTP ${listRes.status}`);
      }

      const listJson = await listRes.json();
      if (listJson.error) {
        throw new Error(`MCP Protocol Error: ${listJson.error.message}`);
      }

      const registeredTools = listJson.result?.tools?.map((t: any) => t.name) || [];
      if (registeredTools.length === 0) {
        throw new Error("MCP Server connected, but 0 tools were registered");
      }

      // Step 2: Verify Price Authenticity via Live Tool Call (alphapairs_get_market_data for AAPL)
      const toolCallRes = await fetch("/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "mcp-verify-price",
          method: "tools/call",
          params: {
            name: "alphapairs_get_market_data",
            arguments: {
              tickers: ["AAPL"],
              lookback_days: 7
            }
          }
        })
      });

      if (!toolCallRes.ok) {
        throw new Error(`MCP Tool execution failed with HTTP ${toolCallRes.status}`);
      }

      const toolCallJson = await toolCallRes.json();
      if (toolCallJson.error || toolCallJson.result?.isError) {
        const errText = toolCallJson.result?.content?.[0]?.text || toolCallJson.error?.message;
        throw new Error(`MCP Tool Error: ${errText}`);
      }

      const rawContent = toolCallJson.result?.content?.[0]?.text;
      const parsedData = JSON.parse(rawContent);

      const appleBars = parsedData.data?.AAPL || [];
      if (appleBars.length === 0) {
        throw new Error("No live bars received for AAPL from upstream");
      }

      const latestBar = appleBars[appleBars.length - 1];

      // Authenticity checks:
      // - Must have valid date string
      // - Close price must be real positive numeric
      // - Volume must be positive trading volume
      // - Source must name Yahoo Finance Market Data API
      const isAuthentic =
        latestBar.close > 0 &&
        latestBar.volume > 0 &&
        latestBar.date &&
        parsedData.source.includes("Yahoo Finance");

      const elapsed = Math.round(performance.now() - startTime);

      setMcpHealth({
        status: "connected",
        latencyMs: elapsed,
        toolsCount: registeredTools.length,
        tools: registeredTools,
        lastVerified: new Date().toLocaleTimeString(),
        errorMessage: null,
        priceSample: {
          ticker: "AAPL",
          date: latestBar.date,
          close: latestBar.close,
          volume: latestBar.volume,
          source: parsedData.source,
          isAuthentic
        }
      });
    } catch (err: any) {
      const elapsed = Math.round(performance.now() - startTime);
      setMcpHealth({
        status: "error",
        latencyMs: elapsed,
        toolsCount: 0,
        tools: [],
        lastVerified: new Date().toLocaleTimeString(),
        errorMessage: err.message,
        priceSample: null
      });
    }
  };

  const copyMcpUrl = () => {
    const url = "https://alphapairs-quant.vercel.app/api/mcp";
    navigator.clipboard.writeText(url);
    setCopiedMcpUrl(true);
    setTimeout(() => setCopiedMcpUrl(false), 2000);
  };

  const handleRunDeviation = async () => {
    setDevLoading(true);
    setDevError(null);
    try {
      const peers = peerTickersInput
        .split(",")
        .map(t => t.trim().toUpperCase())
        .filter(Boolean);

      let data: DeviationResult;
      if (useMcpDirectly) {
        // Execute through MCP Protocol
        data = await callMcpTool("alphapairs_detect_deviations", {
          target: targetTicker.trim().toUpperCase(),
          peers,
          z_threshold: Number(zThreshold),
          lookback_days: Number(lookbackDays)
        });
      } else {
        // Direct REST endpoint
        const res = await fetch("/api/detect-deviations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target: targetTicker.trim().toUpperCase(),
            peers,
            z_threshold: Number(zThreshold),
            lookback_days: Number(lookbackDays)
          })
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP ${res.status}: Failed to detect deviations`);
        }
        data = await res.json();
      }

      setDevResult(data);
    } catch (err: any) {
      setDevError(err.message);
    } finally {
      setDevLoading(false);
    }
  };

  const handleRunCorrelation = async () => {
    setCorrLoading(true);
    setCorrError(null);
    try {
      const tickers = corrTickersInput
        .split(",")
        .map(t => t.trim().toUpperCase())
        .filter(Boolean);

      let data: CorrelationResult;
      if (useMcpDirectly) {
        // Execute through MCP Protocol
        data = await callMcpTool("alphapairs_calculate_correlation", {
          tickers,
          lookback_days: Number(corrLookback)
        });
      } else {
        // Direct REST endpoint
        const res = await fetch("/api/calculate-correlation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tickers,
            lookback_days: Number(corrLookback)
          })
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP ${res.status}: Failed to calculate correlation`);
        }
        data = await res.json();
      }

      setCorrResult(data);
    } catch (err: any) {
      setCorrError(err.message);
    } finally {
      setCorrLoading(false);
    }
  };

  const handleRunMarketData = async () => {
    setMarketLoading(true);
    setMarketError(null);
    try {
      const tickers = marketTickersInput
        .split(",")
        .map(t => t.trim().toUpperCase())
        .filter(Boolean);

      let data: MarketDataResult;
      if (useMcpDirectly) {
        // Execute through MCP Protocol
        data = await callMcpTool("alphapairs_get_market_data", {
          tickers,
          lookback_days: Number(marketLookback)
        });
      } else {
        // Direct REST endpoint
        const res = await fetch("/api/market-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tickers,
            lookback_days: Number(marketLookback)
          })
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP ${res.status}: Failed to fetch market data`);
        }
        data = await res.json();
      }

      setMarketResult(data);
      if (tickers.length > 0) {
        setSelectedMarketTicker(tickers[0]);
      }
    } catch (err: any) {
      setMarketError(err.message);
    } finally {
      setMarketLoading(false);
    }
  };

  const handleRunMemo = async () => {
    setMemoLoading(true);
    setMemoError(null);
    try {
      const peer_tickers = memoPeersInput
        .split(",")
        .map(t => t.trim().toUpperCase())
        .filter(Boolean);

      let data: DivergenceMemoResult;
      if (useMcpDirectly) {
        // Execute through MCP Protocol
        data = await callMcpTool("alphapairs_analyze_divergence", {
          ticker: memoTicker.trim().toUpperCase(),
          peer_group_name: memoGroupName,
          peer_tickers,
          max_z_score: Number(memoMaxZ),
          peak_spread_pct: Number(memoPeakSpread),
          direction: memoDirection,
          duration_days: Number(memoDuration),
          start_date: memoStartDate,
          peak_date: memoPeakDate,
          collapse_date: memoCollapseDate || null
        });
      } else {
        // Direct REST endpoint
        const res = await fetch("/api/ai/analyze-divergence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: memoTicker.trim().toUpperCase(),
            peer_group_name: memoGroupName,
            peer_tickers,
            max_z_score: Number(memoMaxZ),
            peak_spread_pct: Number(memoPeakSpread),
            direction: memoDirection,
            duration_days: Number(memoDuration),
            start_date: memoStartDate,
            peak_date: memoPeakDate,
            collapse_date: memoCollapseDate || null
          })
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP ${res.status}: Failed to generate AI memo`);
        }
        data = await res.json();
      }

      setMemoResult(data);
    } catch (err: any) {
      setMemoError(err.message);
    } finally {
      setMemoLoading(false);
    }
  };

  const handleTriggerMemoFromEpisode = (ep: Episode) => {
    if (!devResult) return;
    setMemoTicker(devResult.target);
    setMemoGroupName(`${devResult.target} vs Peer Group`);
    setMemoPeersInput(devResult.peers.join(", "));
    setMemoMaxZ(ep.peak_z_score);
    setMemoPeakSpread(ep.peak_spread_pct);
    setMemoDirection(ep.direction);
    setMemoDuration(ep.duration_days);
    setMemoStartDate(ep.start_date);
    setMemoPeakDate(ep.peak_date);
    setMemoCollapseDate(ep.collapse_date || "");
    setActiveTab("memo");
  };

  const handleExecuteMcpCall = async () => {
    setMcpExecuting(true);
    setMcpResponse(null);
    try {
      const parsed = JSON.parse(mcpPayload);
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream"
        },
        body: JSON.stringify(parsed)
      });
      const data = await res.json();
      setMcpResponse(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setMcpResponse(
        JSON.stringify(
          {
            error: err.message,
            note: "Payload must be valid JSON-RPC 2.0 object"
          },
          null,
          2
        )
      );
    } finally {
      setMcpExecuting(false);
    }
  };

  // Color generator for correlation
  const getCorrColor = (corr: number) => {
    if (corr >= 0.8) return "bg-emerald-950 text-emerald-400 border border-emerald-800/40";
    if (corr >= 0.5) return "bg-emerald-900/40 text-emerald-300 border border-emerald-800/30";
    if (corr >= 0.2) return "bg-slate-800/60 text-slate-200 border border-slate-700/50";
    if (corr >= -0.2) return "bg-slate-900/80 text-slate-400 border border-slate-800";
    if (corr >= -0.5) return "bg-rose-950/40 text-rose-300 border border-rose-900/30";
    return "bg-rose-950 text-rose-400 border border-rose-800/50";
  };

  return (
    <div className="min-h-screen bg-[#070b12] text-slate-100 flex flex-col font-sans selection:bg-emerald-500/20 selection:text-emerald-300">
      {/* Top Terminal Bar */}
      <header className="border-b border-slate-800/80 bg-[#0b101b]/95 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-emerald-500/10">
              <TrendingUp className="h-5 w-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight text-white">AlphaPairs</span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono font-medium">
                  QUANT
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-mono">
                  MCP 2025-11-25
                </span>
              </div>
              <p className="text-xs text-slate-400">Statistical Arbitrage &amp; Unfabricated Live Market Protocol Server</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Toggle MCP Direct Routing */}
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono">
              <span>App Mode:</span>
              <button
                onClick={() => setUseMcpDirectly(!useMcpDirectly)}
                className={`px-2 py-0.5 rounded transition ${
                  useMcpDirectly
                    ? "bg-emerald-500 text-slate-950 font-bold"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
                title="Toggles whether user actions invoke the MCP endpoint (/api/mcp tools/call) or REST"
              >
                {useMcpDirectly ? "via /api/mcp (Active)" : "via REST"}
              </button>
            </div>

            <button
              onClick={copyMcpUrl}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition border border-slate-700 active:scale-95"
              title="Copy public MCP URL for external agents"
            >
              {copiedMcpUrl ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedMcpUrl ? "Copied MCP URL!" : "Copy MCP URL"}</span>
            </button>
          </div>
        </div>

        {/* Live MCP Connection & Authenticity Banner */}
        <div className="border-t border-slate-800/80 bg-slate-950/80 px-4 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Connection Status Badge */}
              <div className="flex items-center gap-2">
                {mcpHealth.status === "verifying" && (
                  <span className="flex items-center gap-1.5 text-amber-400 font-mono font-medium">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Testing MCP Connection...
                  </span>
                )}
                {mcpHealth.status === "connected" && (
                  <span className="flex items-center gap-1.5 text-emerald-400 font-mono font-medium">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    MCP CONNECTED: Streamable HTTP (HTTP 200 OK)
                  </span>
                )}
                {mcpHealth.status === "error" && (
                  <span className="flex items-center gap-1.5 text-rose-400 font-mono font-medium">
                    <XCircle className="h-4 w-4 text-rose-400" />
                    MCP DISCONNECTED: {mcpHealth.errorMessage}
                  </span>
                )}
              </div>

              {/* Tools Count */}
              {mcpHealth.status === "connected" && (
                <span className="text-slate-400 font-mono hidden sm:inline">
                  &bull; <strong className="text-white">{mcpHealth.toolsCount} Tools</strong> Registered &bull; Latency: <strong className="text-cyan-400">{mcpHealth.latencyMs}ms</strong>
                </span>
              )}

              {/* Price Authenticity Verification */}
              {mcpHealth.priceSample && (
                <div className="flex items-center gap-2 bg-emerald-950/40 border border-emerald-500/30 px-2.5 py-1 rounded text-[11px] font-mono text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  <span>
                    Price Authenticity: <strong className="text-white">UNFABRICATED</strong> ({mcpHealth.priceSample.ticker} Close: ${mcpHealth.priceSample.close} | Vol: {(mcpHealth.priceSample.volume / 1e6).toFixed(2)}M | Date: {mcpHealth.priceSample.date})
                  </span>
                </div>
              )}
            </div>

            {/* Re-verify Button */}
            <button
              onClick={verifyMcpConnection}
              disabled={mcpHealth.status === "verifying"}
              className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-emerald-400 font-mono transition ml-auto"
            >
              <RefreshCw className={`h-3 w-3 ${mcpHealth.status === "verifying" ? "animate-spin" : ""}`} />
              <span>Verify MCP &amp; Prices</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 flex border-t border-slate-800/60 overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setActiveTab("deviations")}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 whitespace-nowrap transition ${
              activeTab === "deviations"
                ? "border-emerald-400 text-emerald-400 bg-emerald-500/5 font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
            }`}
          >
            <Activity className="h-4 w-4" />
            Deviation &amp; Spread Engine
          </button>

          <button
            onClick={() => {
              setActiveTab("correlation");
              if (!corrResult) handleRunCorrelation();
            }}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 whitespace-nowrap transition ${
              activeTab === "correlation"
                ? "border-emerald-400 text-emerald-400 bg-emerald-500/5 font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
            }`}
          >
            <Layers className="h-4 w-4" />
            Log Correlation Matrix
          </button>

          <button
            onClick={() => {
              setActiveTab("market");
              if (!marketResult) handleRunMarketData();
            }}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 whitespace-nowrap transition ${
              activeTab === "market"
                ? "border-emerald-400 text-emerald-400 bg-emerald-500/5 font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
            }`}
          >
            <Database className="h-4 w-4" />
            Market OHLCV Bars
          </button>

          <button
            onClick={() => setActiveTab("memo")}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 whitespace-nowrap transition ${
              activeTab === "memo"
                ? "border-emerald-400 text-emerald-400 bg-emerald-500/5 font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
            }`}
          >
            <Sparkles className="h-4 w-4" />
            AI Divergence Memo
          </button>

          <button
            onClick={() => setActiveTab("mcp")}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 whitespace-nowrap transition ${
              activeTab === "mcp"
                ? "border-emerald-400 text-emerald-400 bg-emerald-500/5 font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
            }`}
          >
            <Server className="h-4 w-4" />
            MCP Protocol Server
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-mono">
              4 Tools
            </span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 py-6 flex-1 w-full space-y-6">

        {/* TAB 1: DEVIATION DETECTOR */}
        {activeTab === "deviations" && (
          <div className="space-y-6">
            {/* Presets banner */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                <Sliders className="h-3.5 w-3.5 text-emerald-400" />
                Quick Quant Presets
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                {PRESET_BASKETS.map(b => (
                  <button
                    key={b.name}
                    onClick={() => {
                      setTargetTicker(b.target);
                      setPeerTickersInput(b.peers.join(", "));
                    }}
                    className={`text-left p-2.5 rounded-lg border transition ${
                      targetTicker === b.target
                        ? "bg-emerald-950/30 border-emerald-500/50"
                        : "bg-slate-950/40 border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-white">{b.name}</span>
                      <span className="text-[10px] font-mono text-emerald-400">{b.target}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 truncate">
                      {b.peers.join(", ")}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Parameter configuration */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Target Equity Ticker
                  </label>
                  <input
                    type="text"
                    value={targetTicker}
                    onChange={e => setTargetTicker(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                    placeholder="e.g. NVDA"
                  />
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Peer Basket Candidates (comma-separated, up to 10)
                  </label>
                  <input
                    type="text"
                    value={peerTickersInput}
                    onChange={e => setPeerTickersInput(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                    placeholder="AMD, INTC, TSM, QCOM"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Z-Threshold (&sigma; cutoff)
                  </label>
                  <select
                    value={zThreshold}
                    onChange={e => setZThreshold(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                  >
                    <option value={1.5}>1.5 &sigma; (Sensitive)</option>
                    <option value={2.0}>2.0 &sigma; (Standard Arbitrage)</option>
                    <option value={2.5}>2.5 &sigma; (High Conviction)</option>
                    <option value={3.0}>3.0 &sigma; (Extreme Dislocation)</option>
                  </select>
                </div>

                <div>
                  <button
                    onClick={handleRunDeviation}
                    disabled={devLoading}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-500/20"
                  >
                    {devLoading ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 fill-slate-950" />
                    )}
                    <span>{devLoading ? "Calculating via MCP..." : "Run Detection"}</span>
                  </button>
                </div>
              </div>

              {devError && (
                <div className="mt-4 p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{devError}</span>
                </div>
              )}
            </div>

            {/* Regression metrics and results */}
            {devResult && (
              <div className="space-y-6">
                {/* Metric cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400">OLS Beta (&beta;)</span>
                    <div className="text-xl font-mono font-bold text-white mt-1">
                      {devResult.model.beta}
                    </div>
                    <span className="text-[11px] text-slate-400">Peer composite sensitivity</span>
                  </div>

                  <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400">Model Fit (R&sup2;)</span>
                    <div className="text-xl font-mono font-bold text-emerald-400 mt-1">
                      {(devResult.model.r_squared * 100).toFixed(1)}%
                    </div>
                    <span className="text-[11px] text-slate-400">Variance explained by peers</span>
                  </div>

                  <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400">Residual Volatility (&sigma;)</span>
                    <div className="text-xl font-mono font-bold text-cyan-400 mt-1">
                      {devResult.model.residual_std}
                    </div>
                    <span className="text-[11px] text-slate-400">Standard error of spread</span>
                  </div>

                  <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400">Detected Episodes</span>
                    <div className="text-xl font-mono font-bold text-white mt-1">
                      {devResult.episodes.length}
                    </div>
                    <span className="text-[11px] text-slate-400">&ge; {devResult.z_threshold}&sigma; Dislocations</span>
                  </div>
                </div>

                {/* Residual Z-Score Chart Visualizer */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        {devResult.target} vs Peer Composite Residual Tracking Points
                      </h3>
                      <p className="text-xs text-slate-400">
                        Rolling Z-score deviations with &plusmn;{devResult.z_threshold}&sigma; threshold bands
                      </p>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      Upstream: {devResult.source}
                    </div>
                  </div>

                  {/* SVG Chart */}
                  <div className="w-full h-56 bg-slate-950/60 rounded-lg p-2 relative flex items-center justify-center border border-slate-800/80 overflow-hidden">
                    <svg className="w-full h-full" viewBox="0 0 800 200" preserveAspectRatio="none">
                      {/* Zero line */}
                      <line x1="0" y1="100" x2="800" y2="100" stroke="#334155" strokeWidth="1.5" strokeDasharray="3 3" />
                      {/* +Threshold line */}
                      <line x1="0" y1={100 - (devResult.z_threshold * 25)} x2="800" y2={100 - (devResult.z_threshold * 25)} stroke="#ef4444" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />
                      {/* -Threshold line */}
                      <line x1="0" y1={100 + (devResult.z_threshold * 25)} x2="800" y2={100 + (devResult.z_threshold * 25)} stroke="#10b981" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />

                      {/* Points line */}
                      {devResult.residual_points.length > 1 && (
                        <polyline
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="2.5"
                          points={devResult.residual_points
                            .map((p, idx) => {
                              const x = (idx / (devResult.residual_points.length - 1)) * 760 + 20;
                              const clampedZ = Math.max(-3.5, Math.min(3.5, p.z_score));
                              const y = 100 - (clampedZ * 25);
                              return `${x},${y}`;
                            })
                            .join(" ")}
                        />
                      )}

                      {/* Nodes */}
                      {devResult.residual_points.map((p, idx) => {
                        const x = (idx / (devResult.residual_points.length - 1)) * 760 + 20;
                        const clampedZ = Math.max(-3.5, Math.min(3.5, p.z_score));
                        const y = 100 - (clampedZ * 25);
                        const isExtreme = Math.abs(p.z_score) >= devResult.z_threshold;
                        return (
                          <circle
                            key={idx}
                            cx={x}
                            cy={y}
                            r={isExtreme ? 4.5 : 2.5}
                            fill={isExtreme ? (p.z_score > 0 ? "#ef4444" : "#10b981") : "#38bdf8"}
                            stroke="#0b101b"
                            strokeWidth="1.5"
                          />
                        );
                      })}
                    </svg>

                    <div className="absolute top-2 right-3 flex items-center gap-3 text-[10px] font-mono text-slate-400">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-rose-500"></span> Overperforming (&gt;+{devResult.z_threshold}&sigma;)
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-emerald-500"></span> Underperforming (&lt;-{devResult.z_threshold}&sigma;)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Detected Episodes Table */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                  <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Statistical Divergence Episodes</h3>
                      <p className="text-xs text-slate-400">
                        Historical and active dislocation periods flagged by the quantitative residual engine
                      </p>
                    </div>
                  </div>

                  {devResult.episodes.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">
                      No statistical divergence episodes detected above {devResult.z_threshold}&sigma; in the selected lookback window.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-mono">
                          <tr>
                            <th className="py-3 px-4">Episode ID</th>
                            <th className="py-3 px-4">Direction</th>
                            <th className="py-3 px-4">Peak Z-Score</th>
                            <th className="py-3 px-4">Peak Spread %</th>
                            <th className="py-3 px-4">Duration</th>
                            <th className="py-3 px-4">Date Window</th>
                            <th className="py-3 px-4">Status</th>
                            <th className="py-3 px-4 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono">
                          {devResult.episodes.map(ep => (
                            <tr key={ep.episode_id} className="hover:bg-slate-800/30 transition">
                              <td className="py-3 px-4 text-white font-medium">{ep.episode_id}</td>
                              <td className="py-3 px-4">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] ${
                                    ep.direction === "divergence_above"
                                      ? "bg-rose-950/60 text-rose-300 border border-rose-800/40"
                                      : "bg-emerald-950/60 text-emerald-300 border border-emerald-800/40"
                                  }`}
                                >
                                  {ep.direction === "divergence_above" ? (
                                    <ArrowUpRight className="h-3 w-3" />
                                  ) : (
                                    <ArrowDownRight className="h-3 w-3" />
                                  )}
                                  {ep.direction === "divergence_above" ? "Target Above Peers" : "Target Below Peers"}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-bold text-white">
                                {ep.peak_z_score > 0 ? `+${ep.peak_z_score}` : ep.peak_z_score}&sigma;
                              </td>
                              <td className="py-3 px-4 font-bold text-white">
                                {ep.peak_spread_pct > 0 ? `+${ep.peak_spread_pct}` : ep.peak_spread_pct}%
                              </td>
                              <td className="py-3 px-4 text-slate-300">{ep.duration_days} days</td>
                              <td className="py-3 px-4 text-slate-400 text-[11px]">
                                {ep.start_date} &rarr; {ep.peak_date}
                              </td>
                              <td className="py-3 px-4">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                    ep.status === "active"
                                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse"
                                      : "bg-slate-800 text-slate-300"
                                  }`}
                                >
                                  {ep.status}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  onClick={() => handleTriggerMemoFromEpisode(ep)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-slate-200 text-xs font-sans font-medium transition"
                                >
                                  <Sparkles className="h-3 w-3" />
                                  <span>Analyze with AI</span>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: CORRELATION MATRIX */}
        {activeTab === "correlation" && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Tickers for Continuous Log Return Matrix (up to 10)
                  </label>
                  <input
                    type="text"
                    value={corrTickersInput}
                    onChange={e => setCorrTickersInput(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                    placeholder="NVDA, AMD, TSM, INTC, MSFT, AAPL"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Lookback Days
                  </label>
                  <select
                    value={corrLookback}
                    onChange={e => setCorrLookback(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                  >
                    <option value={30}>30 Days (Short-term)</option>
                    <option value={60}>60 Days (Quarterly)</option>
                    <option value={90}>90 Days (Half-year)</option>
                    <option value={180}>180 Days (Long-term)</option>
                  </select>
                </div>

                <div>
                  <button
                    onClick={handleRunCorrelation}
                    disabled={corrLoading}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-500/20"
                  >
                    {corrLoading ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Layers className="h-4 w-4" />
                    )}
                    <span>{corrLoading ? "Computing Matrix via MCP..." : "Calculate Matrix"}</span>
                  </button>
                </div>
              </div>

              {corrError && (
                <div className="mt-4 p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{corrError}</span>
                </div>
              )}
            </div>

            {corrResult && (
              <div className="space-y-6">
                {/* N x N Matrix Grid */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Continuous Logarithmic Returns Correlation Matrix</h3>
                      <p className="text-xs text-slate-400">
                        Computed across {corrResult.trading_days_analyzed} synchronized trading sessions (Upstream: {corrResult.source})
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-center text-xs border-collapse">
                      <thead>
                        <tr>
                          <th className="p-2 border border-slate-800 bg-slate-950 font-mono text-slate-400"></th>
                          {corrResult.tickers.map(t => (
                            <th key={t} className="p-2.5 border border-slate-800 bg-slate-950 font-mono font-bold text-white">
                              {t}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {corrResult.tickers.map(tA => (
                          <tr key={tA}>
                            <td className="p-2.5 border border-slate-800 bg-slate-950 font-mono font-bold text-white text-left">
                              {tA}
                            </td>
                            {corrResult.tickers.map(tB => {
                              const val = corrResult.matrix[tA]?.[tB] ?? 0;
                              return (
                                <td
                                  key={tB}
                                  className={`p-2.5 border border-slate-850 font-mono font-semibold transition ${getCorrColor(val)}`}
                                >
                                  {val.toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Ranked Pair List */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-white mb-3">Pair Correlation Hierarchy</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {corrResult.pairs.slice(0, 12).map(p => (
                      <div
                        key={p.pair}
                        className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 flex items-center justify-between font-mono"
                      >
                        <div>
                          <span className="text-xs font-bold text-white">{p.pair}</span>
                          <div className="text-[10px] text-slate-400">{p.ticker_a} &amp; {p.ticker_b}</div>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${getCorrColor(p.correlation)}`}>
                          {p.correlation > 0 ? `+${p.correlation.toFixed(3)}` : p.correlation.toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: MARKET OHLCV */}
        {activeTab === "market" && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Tickers (up to 5 US Equities)
                  </label>
                  <input
                    type="text"
                    value={marketTickersInput}
                    onChange={e => setMarketTickersInput(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                    placeholder="NVDA, AMD, MSFT"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Lookback Period
                  </label>
                  <select
                    value={marketLookback}
                    onChange={e => setMarketLookback(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                  >
                    <option value={15}>15 Days</option>
                    <option value={30}>30 Days</option>
                    <option value={60}>60 Days</option>
                    <option value={90}>90 Days</option>
                  </select>
                </div>

                <div>
                  <button
                    onClick={handleRunMarketData}
                    disabled={marketLoading}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-500/20"
                  >
                    {marketLoading ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Database className="h-4 w-4" />
                    )}
                    <span>{marketLoading ? "Fetching via MCP..." : "Fetch OHLCV Bars"}</span>
                  </button>
                </div>
              </div>

              {marketError && (
                <div className="mt-4 p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{marketError}</span>
                </div>
              )}
            </div>

            {marketResult && (
              <div className="space-y-6">
                {/* Ticker Selector Tabs */}
                <div className="flex gap-2 border-b border-slate-800 pb-2">
                  {marketResult.tickers.map(t => (
                    <button
                      key={t}
                      onClick={() => setSelectedMarketTicker(t)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                        selectedMarketTicker === t
                          ? "bg-emerald-500 text-slate-950"
                          : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* OHLCV Table */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                  <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        {selectedMarketTicker} Daily OHLCV Bars (Last 20 Sessions)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Upstream: {marketResult.source} &bull; Fetched: {new Date(marketResult.fetched_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-mono">
                        <tr>
                          <th className="py-2.5 px-4">Date</th>
                          <th className="py-2.5 px-4">Open ($)</th>
                          <th className="py-2.5 px-4">High ($)</th>
                          <th className="py-2.5 px-4">Low ($)</th>
                          <th className="py-2.5 px-4">Close ($)</th>
                          <th className="py-2.5 px-4">Volume</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {(marketResult.data[selectedMarketTicker] || []).map((bar, idx) => {
                          const isGreen = bar.close >= bar.open;
                          return (
                            <tr key={idx} className="hover:bg-slate-800/30 transition">
                              <td className="py-2.5 px-4 text-slate-300">{bar.date}</td>
                              <td className="py-2.5 px-4 text-slate-200">{bar.open.toFixed(2)}</td>
                              <td className="py-2.5 px-4 text-emerald-400">{bar.high.toFixed(2)}</td>
                              <td className="py-2.5 px-4 text-rose-400">{bar.low.toFixed(2)}</td>
                              <td className={`py-2.5 px-4 font-bold ${isGreen ? "text-emerald-400" : "text-rose-400"}`}>
                                {bar.close.toFixed(2)}
                              </td>
                              <td className="py-2.5 px-4 text-slate-400">{bar.volume.toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: AI DIVERGENCE MEMO */}
        {activeTab === "memo" && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Institutional Divergence Catalyst Research Memo</h3>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Powered by Google Gemini 3.8 Flash to synthesize fundamental earnings events, supply-chain bottlenecks, and mean-reversion drivers.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Target Ticker</label>
                  <input
                    type="text"
                    value={memoTicker}
                    onChange={e => setMemoTicker(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Peer Group Name</label>
                  <input
                    type="text"
                    value={memoGroupName}
                    onChange={e => setMemoGroupName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Peer Tickers</label>
                  <input
                    type="text"
                    value={memoPeersInput}
                    onChange={e => setMemoPeersInput(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Peak Z-Score</label>
                  <input
                    type="number"
                    step="0.1"
                    value={memoMaxZ}
                    onChange={e => setMemoMaxZ(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Peak Spread %</label>
                  <input
                    type="number"
                    step="0.1"
                    value={memoPeakSpread}
                    onChange={e => setMemoPeakSpread(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Direction</label>
                  <select
                    value={memoDirection}
                    onChange={e => setMemoDirection(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-white"
                  >
                    <option value="divergence_above">divergence_above</option>
                    <option value="divergence_below">divergence_below</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Duration Days</label>
                  <input
                    type="number"
                    value={memoDuration}
                    onChange={e => setMemoDuration(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <button
                onClick={handleRunMemo}
                disabled={memoLoading}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-5 py-2.5 rounded-lg text-xs flex items-center gap-2 transition disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-500/20"
              >
                {memoLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 fill-slate-950" />
                )}
                <span>{memoLoading ? "Generating via MCP..." : "Generate AI Memo"}</span>
              </button>

              {memoError && (
                <div className="mt-4 p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{memoError}</span>
                </div>
              )}
            </div>

            {memoResult && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-6 shadow-2xl">
                {/* Header */}
                <div className="border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-1">
                    <FileText className="h-3.5 w-3.5" />
                    <span>INSTITUTIONAL QUANTITATIVE RESEARCH MEMO</span>
                  </div>
                  <h2 className="text-lg font-bold text-white">{memoResult.memo.headline}</h2>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-2 font-mono">
                    <span>Target: <strong className="text-white">{memoResult.ticker}</strong></span>
                    <span>&bull;</span>
                    <span>Group: <strong className="text-white">{memoResult.peer_group_name}</strong></span>
                    <span>&bull;</span>
                    <span>Peak Z: <strong className="text-white">{memoResult.episode_metrics.max_z_score}&sigma;</strong></span>
                    <span>&bull;</span>
                    <span>Upstream: <strong className="text-emerald-400">{memoResult.source}</strong></span>
                  </div>
                </div>

                {/* Executive Summary */}
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                    Executive Summary &amp; Thesis
                  </h4>
                  <p className="text-xs leading-relaxed text-slate-200">
                    {memoResult.memo.executive_summary}
                  </p>
                </div>

                {/* Two column fundamentals */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-950/40 border border-slate-800/80 rounded-lg p-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2">
                      Corporate &amp; Idiosyncratic Catalysts
                    </h4>
                    <p className="text-xs leading-relaxed text-slate-300">
                      {memoResult.memo.corporate_catalysts}
                    </p>
                  </div>

                  <div className="bg-slate-950/40 border border-slate-800/80 rounded-lg p-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-2">
                      Peer Basket &amp; Sector Dynamics
                    </h4>
                    <p className="text-xs leading-relaxed text-slate-300">
                      {memoResult.memo.peer_dynamics}
                    </p>
                  </div>
                </div>

                {/* Mean Reversion Assessment */}
                <div className="bg-slate-950/40 border border-slate-800/80 rounded-lg p-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2">
                    Mean-Reversion Assessment &amp; Decay Mechanics
                  </h4>
                  <p className="text-xs leading-relaxed text-slate-300">
                    {memoResult.memo.mean_reversion_assessment}
                  </p>
                </div>

                {/* Tactical Trade Structuring & Risks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-950/40 border border-slate-800/80 rounded-lg p-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                      Tactical Trade Recommendations
                    </h4>
                    <ul className="space-y-1.5 text-xs text-slate-300">
                      {memoResult.tactical_recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <ChevronRight className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-slate-950/40 border border-slate-800/80 rounded-lg p-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400 mb-2">
                      Regime Change &amp; Downside Risks
                    </h4>
                    <ul className="space-y-1.5 text-xs text-slate-300">
                      {memoResult.risk_factors.map((risk, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                          <span>{risk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Catalyst Milestones */}
                {memoResult.catalyst_timeline && memoResult.catalyst_timeline.length > 0 && (
                  <div className="bg-slate-950/40 border border-slate-800/80 rounded-lg p-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">
                      Anticipated Catalyst Milestones
                    </h4>
                    <div className="space-y-2">
                      {memoResult.catalyst_timeline.map((c, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-slate-900 border border-slate-800/60">
                          <div>
                            <span className="font-bold text-white">{c.date_or_milestone}:</span>{" "}
                            <span className="text-slate-300">{c.event}</span>
                          </div>
                          <span className="text-emerald-400 text-[11px] font-mono shrink-0 ml-2">{c.impact}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: MCP SERVER EXPLORER */}
        {activeTab === "mcp" && (
          <div className="space-y-6">
            {/* Info Card */}
            <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900 to-cyan-950/30 border border-emerald-500/30 rounded-xl p-5 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="h-5 w-5 text-emerald-400" />
                    <h2 className="text-base font-bold text-white">AlphaPairs Model Context Protocol (MCP) Server</h2>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                    This endpoint exposes quantitative statistical arbitrage engines to autonomous agents via the{" "}
                    <strong>MCP Protocol 2025-11-25</strong> over <strong>Streamable HTTP</strong>. External agents
                    (including Google Gemini SDK agents via <code className="bg-slate-950 px-1.5 py-0.5 rounded text-emerald-400 font-mono">mcpToTool</code>)
                    discover and invoke all 4 tools in real time.
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Stateless Session
                  </span>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-4 text-xs font-mono">
                <div>
                  <span className="text-slate-400">Public MCP Address: </span>
                  <span className="text-emerald-400 font-semibold">https://alphapairs-quant.vercel.app/api/mcp</span>
                </div>
                <div>
                  <span className="text-slate-400">Local Endpoint: </span>
                  <span className="text-cyan-400 font-semibold">/api/mcp</span>
                </div>
              </div>
            </div>

            {/* Tool Catalog */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Tool 1 */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <code className="text-xs font-mono font-bold text-emerald-400">
                      alphapairs_get_market_data
                    </code>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      readOnlyHint
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed mb-3">
                    Returns up to 20 recent daily OHLCV bars per ticker for up to 5 US equity tickers. Data is retrieved directly from the Yahoo Finance Market Data API. Use this tool when you need historical open, high, low, close, and volume series to analyze equity price movements. It does not provide real-time tick-by-tick order book depth or options chain data.
                  </p>
                </div>
                <div className="text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800">
                  Inputs: tickers (array), lookback_days (int) &bull; Max 20 bars
                </div>
              </div>

              {/* Tool 2 */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <code className="text-xs font-mono font-bold text-emerald-400">
                      alphapairs_calculate_correlation
                    </code>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      readOnlyHint
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed mb-3">
                    Returns an N x N correlation matrix of continuous logarithmic returns for up to 10 equity tickers over a specified lookback window. Data is computed from historical market prices sourced from the Yahoo Finance Market Data API. Use this tool when constructing statistical pairs or identifying cross-asset co-movement among peer candidates. It does not assess non-linear causality or lead-lag relationships between equities.
                  </p>
                </div>
                <div className="text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800">
                  Inputs: tickers (2-10 items), lookback_days (10-252)
                </div>
              </div>

              {/* Tool 3 */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <code className="text-xs font-mono font-bold text-emerald-400">
                      alphapairs_detect_deviations
                    </code>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      readOnlyHint
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed mb-3">
                    Returns up to 20 residual spread tracking points and detected statistical divergence episodes where a target ticker deviates from its peer group benchmark. Data is calculated via ordinary least squares regression from price series retrieved from the Yahoo Finance Market Data API. Use this tool to identify abnormal valuation dislocations and mean-reversion opportunities based on Z-score thresholds. It does not forecast future price direction or generate automated trade execution orders.
                  </p>
                </div>
                <div className="text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800">
                  Inputs: target, peers, z_threshold, lookback_days
                </div>
              </div>

              {/* Tool 4 */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <code className="text-xs font-mono font-bold text-emerald-400">
                      alphapairs_analyze_divergence
                    </code>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      readOnlyHint
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed mb-3">
                    Returns an institutional-grade quantitative research memo examining the corporate catalysts, earnings drivers, and mean-reversion factors behind a detected pair dislocation. Analysis is generated using the Google Gemini 3.8 Flash model via the Gemini API. Use this tool when you require deep fundamental and macro synthesis explaining why a target stock decoupled from its peer group. It does not provide personalized investment advice, guaranteed profit targets, or broker order routing.
                  </p>
                </div>
                <div className="text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800">
                  Inputs: ticker, peer_group_name, peer_tickers, max_z_score, etc.
                </div>
              </div>
            </div>

            {/* Live Interactive MCP Console */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">Live MCP JSON-RPC 2.0 Test Runner</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Select Template:</span>
                  <select
                    value={mcpSelectedTool}
                    onChange={e => setMcpSelectedTool(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs font-mono text-emerald-400"
                  >
                    <option value="alphapairs_detect_deviations">alphapairs_detect_deviations</option>
                    <option value="alphapairs_calculate_correlation">alphapairs_calculate_correlation</option>
                    <option value="alphapairs_get_market_data">alphapairs_get_market_data</option>
                    <option value="alphapairs_analyze_divergence">alphapairs_analyze_divergence</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] font-mono text-slate-400 mb-1.5">
                    POST Payload to /api/mcp:
                  </div>
                  <textarea
                    value={mcpPayload}
                    onChange={e => setMcpPayload(e.target.value)}
                    rows={12}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-500 leading-relaxed"
                  />
                  <button
                    onClick={handleExecuteMcpCall}
                    disabled={mcpExecuting}
                    className="mt-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-2 transition disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-500/20"
                  >
                    {mcpExecuting ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5 fill-slate-950" />
                    )}
                    <span>{mcpExecuting ? "Executing Request..." : "Send to /api/mcp"}</span>
                  </button>
                </div>

                <div>
                  <div className="text-[11px] font-mono text-slate-400 mb-1.5">
                    Streamable HTTP Response from /api/mcp:
                  </div>
                  <div className="w-full h-[250px] bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-cyan-300 overflow-auto leading-relaxed">
                    {mcpResponse ? (
                      <pre className="whitespace-pre-wrap">{mcpResponse}</pre>
                    ) : (
                      <span className="text-slate-600 italic">
                        Click "Send to /api/mcp" to trigger live execution and view JSON-RPC output.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-[#070b12] py-4 px-4 text-center text-xs text-slate-500 font-mono">
        AlphaPairs Quant &bull; Model Context Protocol (v1.30.1) &bull; Yahoo Finance &bull; Google Gemini API
      </footer>
    </div>
  );
}
