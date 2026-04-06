import { useState, useEffect } from "react";
import { api } from "../lib/api.js";

interface PredictionStats {
  openPositions: number;
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  totalWagered: number;
  bestTrade: number;
  worstTrade: number;
}

interface Position {
  id: string;
  market: string;
  platform: string;
  outcome: string;
  entry_price: number;
  quantity: number;
  cost_basis: number;
  current_value: number;
  confidence: number;
  thesis: string;
  status: string;
  pnl: number;
  opened_at: number;
  closed_at?: number;
}

interface DailyPnl {
  date: string;
  trades_placed: number;
  total_pnl: number;
  total_wagered: number;
}

function formatUsd(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

const STATUS_COLORS: Record<string, string> = {
  open: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  closed: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  stopped: "text-red-400 bg-red-500/10 border-red-500/20",
};

export function Predictions() {
  const [stats, setStats] = useState<PredictionStats | null>(null);
  const [positions, setPositions] = useState<{ open: Position[]; history: Position[] }>({ open: [], history: [] });
  const [daily, setDaily] = useState<DailyPnl[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "positions" | "history">("overview");
  const [liveEvents, setLiveEvents] = useState<Array<{ type: string; message: string; timestamp: number }>>([]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      const [s, p, d, events] = await Promise.all([
        fetch("/api/predictions/stats").then((r) => r.json()).catch(() => null),
        fetch("/api/predictions/positions").then((r) => r.json()).catch(() => ({ open: [], history: [] })),
        fetch("/api/predictions/daily").then((r) => r.json()).catch(() => ({ days: [] })),
        fetch("/api/tasks").then((r) => r.json()).catch(() => ({ events: [] })),
      ]);
      if (s) setStats(s);
      setPositions(p);
      setDaily(d.days ?? []);
      // Filter prediction-related events
      const predEvents = (events.events ?? []).filter((e: { message: string }) => {
        const m = (e.message ?? "").toLowerCase();
        return m.includes("predict") || m.includes("market") || m.includes("scan") ||
               m.includes("paper") || m.includes("trade") || m.includes("polymarket") ||
               m.includes("kalshi") || m.includes("confidence") || m.includes("autonomous");
      });
      setLiveEvents(predEvents.slice(0, 30));
    } catch { /* ignore */ }
    setLoading(false);
  }

  const pnlColor = (n: number) => n >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-3xl font-bold text-zinc-100 tracking-tight mb-1.5">Predictions</h1>
        <p className="text-sm text-zinc-500">Prediction market trading — Polymarket, Kalshi, and more</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Total P&L" value={formatUsd(stats.totalPnl)} color={pnlColor(stats.totalPnl)} />
          <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} color={stats.winRate >= 50 ? "text-emerald-400" : "text-amber-400"} />
          <StatCard label="Open Positions" value={stats.openPositions} color="text-blue-400" />
          <StatCard label="Total Trades" value={stats.totalTrades} />
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Total Wagered" value={`$${stats.totalWagered.toFixed(2)}`} />
          <StatCard label="Best Trade" value={formatUsd(stats.bestTrade)} color="text-emerald-400" />
          <StatCard label="Worst Trade" value={formatUsd(stats.worstTrade)} color="text-red-400" />
          <StatCard label="ROI" value={stats.totalWagered > 0 ? `${((stats.totalPnl / stats.totalWagered) * 100).toFixed(1)}%` : "0%"} color={pnlColor(stats.totalPnl)} />
        </div>
      )}

      {/* Risk Management Banner */}
      <div className="card p-4 border-l-4 border-amber-500">
        <div className="flex items-start gap-3">
          <span className="text-amber-400 text-lg">⚠</span>
          <div>
            <p className="text-[13px] font-medium text-zinc-200">Risk Management Active</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Max 10% per trade &middot; Max 50% total exposure &middot; 85% min confidence &middot; $3 daily loss limit &middot; Max 5 positions
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5">
        {(["overview", "positions", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-[13px] font-medium transition-colors ${
              tab === t ? "bg-violet-600 text-white" : "text-zinc-500 bg-zinc-800/50 hover:bg-zinc-800"
            }`}
          >
            {t === "overview" ? "Overview" : t === "positions" ? `Open (${positions.open.length})` : "History"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Left: Main content (2 cols) */}
      <div className="lg:col-span-2">
      {loading ? (
        <div className="text-center py-20">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-zinc-600">Loading prediction data...</p>
        </div>
      ) : tab === "overview" ? (
        <div className="space-y-4">
          {/* Daily P&L Chart (text-based) */}
          <div className="card p-5">
            <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider mb-4">Daily P&L</h3>
            {daily.length === 0 ? (
              <p className="text-sm text-zinc-600 text-center py-8">No trading activity yet. Melista will start researching markets during study sessions.</p>
            ) : (
              <div className="space-y-2">
                {daily.slice(0, 14).map((d) => (
                  <div key={d.date} className="flex items-center gap-3">
                    <span className="text-[11px] text-zinc-600 font-mono w-20">{d.date}</span>
                    <div className="flex-1 h-5 bg-zinc-900 rounded overflow-hidden">
                      {d.total_pnl !== 0 && (
                        <div
                          className={`h-full rounded ${d.total_pnl >= 0 ? "bg-emerald-500/40" : "bg-red-500/40"}`}
                          style={{ width: `${Math.min(Math.abs(d.total_pnl) / 10, 100)}%` }}
                        />
                      )}
                    </div>
                    <span className={`text-[12px] font-mono w-20 text-right ${pnlColor(d.total_pnl)}`}>
                      {formatUsd(d.total_pnl)}
                    </span>
                    <span className="text-[10px] text-zinc-600 w-14 text-right">{d.trades_placed} trades</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5 text-center">
            <p className="text-sm text-zinc-400 mb-2">Talk to Melista to research and place trades</p>
            <p className="text-xs text-zinc-600">Chat: "Research the US election markets on Polymarket and find mispriced bets"</p>
          </div>
        </div>
      ) : tab === "positions" ? (
        <div className="space-y-3">
          {positions.open.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-sm text-zinc-600">No open positions. Melista will identify opportunities through market research.</p>
            </div>
          ) : positions.open.map((p) => (
            <PositionCard key={p.id} position={p} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {positions.history.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-sm text-zinc-600">No trade history yet.</p>
            </div>
          ) : positions.history.map((p) => (
            <PositionCard key={p.id} position={p} />
          ))}
        </div>
      )}
      </div>

      {/* Right: Live Activity Feed */}
      <div className="lg:col-span-1">
        <div className="card p-4 sticky top-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">Live Feed</h3>
          </div>

          {liveEvents.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-[12px] text-zinc-600">Waiting for prediction activity...</p>
              <p className="text-[10px] text-zinc-700 mt-1">Scans every 30 min</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {liveEvents.map((e, i) => {
                const isResearch = (e.message ?? "").toLowerCase().includes("scan") || (e.message ?? "").toLowerCase().includes("research");
                const isTrade = (e.message ?? "").toLowerCase().includes("trade") || (e.message ?? "").toLowerCase().includes("paper");
                const isResult = (e.message ?? "").toLowerCase().includes("complete") || (e.message ?? "").toLowerCase().includes("no trades");

                const dotColor = isTrade ? "bg-violet-400" : isResearch ? "bg-blue-400" : isResult ? "bg-amber-400" : "bg-zinc-600";
                const textColor = isTrade ? "text-violet-300" : isResearch ? "text-blue-300" : isResult ? "text-amber-300" : "text-zinc-400";

                return (
                  <div key={i} className="flex gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${dotColor} mt-1.5 shrink-0`} />
                    <div className="min-w-0">
                      <p className={`text-[11px] ${textColor} leading-relaxed`}>
                        {e.message?.slice(0, 150)}
                      </p>
                      <p className="text-[9px] text-zinc-700 font-mono">
                        {new Date(e.timestamp).toLocaleTimeString([], { hour12: false })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-zinc-800/50">
            <p className="text-[10px] text-zinc-600">
              Scanning: sports, crypto, economy, tech, politics, global events
            </p>
            <p className="text-[10px] text-zinc-700 mt-0.5">
              85% min confidence &middot; 10% max per trade &middot; Quick in/out daily
            </p>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

function PositionCard({ position: p }: { position: Position }) {
  const pnlColor = p.pnl >= 0 ? "text-emerald-400" : "text-red-400";
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${STATUS_COLORS[p.status] ?? STATUS_COLORS.open}`}>
              {p.status}
            </span>
            <span className="text-[10px] text-zinc-600 uppercase">{p.platform}</span>
          </div>
          <p className="text-[14px] font-medium text-zinc-200">{p.market}</p>
          <p className="text-[12px] text-zinc-500 mt-0.5">Outcome: {p.outcome} &middot; Confidence: {(p.confidence * 100).toFixed(0)}%</p>
          {p.thesis && <p className="text-[11px] text-zinc-600 mt-1 italic">{p.thesis.slice(0, 100)}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className={`text-lg font-bold font-mono ${pnlColor}`}>{formatUsd(p.pnl)}</p>
          <p className="text-[11px] text-zinc-600">Cost: ${p.cost_basis.toFixed(2)}</p>
          <p className="text-[10px] text-zinc-600">{formatDate(p.opened_at)}</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="card p-4">
      <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${color ?? "text-zinc-100"}`}>{value}</p>
    </div>
  );
}
