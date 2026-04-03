import { useState, useEffect } from "react";
import { api, type FreelancerBid } from "../lib/api.js";

const STATUS_COLORS: Record<string, string> = {
  pending: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  awarded: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  rejected: "text-red-400 bg-red-500/10 border-red-500/20",
  revoked: "text-zinc-500 bg-zinc-500/10 border-zinc-500/20",
  complete: "text-blue-400 bg-blue-500/10 border-blue-500/20",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getBidStatus(bid: FreelancerBid): string {
  if (bid.completeStatus === "complete") return "complete";
  if (bid.awardStatus === "awarded") return "awarded";
  if (bid.awardStatus === "rejected") return "rejected";
  if (bid.awardStatus === "revoked") return "revoked";
  return "pending";
}

export function Bids() {
  const [bids, setBids] = useState<FreelancerBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FreelancerBid | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    loadBids();
    const interval = setInterval(loadBids, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadBids() {
    try {
      const data = await api.getFreelancerBids();
      setBids(data.bids);
      if (data.error) setError(data.error);
      else setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bids");
    } finally {
      setLoading(false);
    }
  }

  const filtered = filter === "all" ? bids : bids.filter((b) => getBidStatus(b) === filter);

  const stats = {
    total: bids.length,
    pending: bids.filter((b) => getBidStatus(b) === "pending").length,
    awarded: bids.filter((b) => getBidStatus(b) === "awarded").length,
    totalValue: bids.reduce((s, b) => s + b.amount, 0),
    avgBid: bids.length > 0 ? bids.reduce((s, b) => s + b.amount, 0) / bids.length : 0,
  };

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-3xl font-bold text-zinc-100 tracking-tight mb-1.5">Bids</h1>
        <p className="text-sm text-zinc-500">Submitted proposals across all marketplaces</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Total Bids" value={stats.total} />
        <StatCard label="Pending" value={stats.pending} color="text-amber-400" />
        <StatCard label="Awarded" value={stats.awarded} color="text-emerald-400" />
        <StatCard label="Total Value" value={`$${stats.totalValue.toLocaleString()}`} />
        <StatCard label="Avg Bid" value={`$${stats.avgBid.toFixed(0)}`} />
      </div>

      {/* Filter */}
      <div className="flex gap-1.5">
        {["all", "pending", "awarded", "rejected", "complete"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              filter === f
                ? "bg-violet-600 text-white"
                : "text-zinc-500 hover:text-zinc-300 bg-zinc-800/50 hover:bg-zinc-800"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[13px] text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-zinc-600">Loading bids...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-sm text-zinc-600">
            {bids.length === 0 ? "No bids submitted yet. Melista will start bidding on the next poll cycle." : "No bids match this filter."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Bid list */}
          <div className="lg:col-span-2 space-y-2">
            {filtered.map((bid) => {
              const status = getBidStatus(bid);
              return (
                <button
                  key={bid.id}
                  onClick={() => setSelected(bid)}
                  className={`w-full text-left card p-4 transition-colors hover:border-zinc-700 ${
                    selected?.id === bid.id ? "border-violet-500/50" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-zinc-200 truncate">{bid.projectTitle}</p>
                      <p className="text-[11px] text-zinc-600 mt-0.5">
                        Freelancer.com &middot; {formatTime(bid.submittedAt)} &middot; {bid.period} day delivery
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[15px] font-bold text-zinc-200 font-mono">
                        ${bid.amount}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${STATUS_COLORS[status] ?? STATUS_COLORS.pending}`}>
                        {status}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-1">
            {selected ? (
              <div className="card p-5 space-y-4 sticky top-8">
                <div>
                  <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Project</p>
                  <p className="text-[14px] font-medium text-zinc-200">{selected.projectTitle}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Bid Amount</p>
                    <p className="text-xl font-bold text-zinc-100 font-mono">${selected.amount}</p>
                    <p className="text-[10px] text-zinc-600">{selected.currency}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Delivery</p>
                    <p className="text-xl font-bold text-zinc-100 font-mono">{selected.period}d</p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Status</p>
                  <span className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider border ${STATUS_COLORS[getBidStatus(selected)] ?? STATUS_COLORS.pending}`}>
                    {getBidStatus(selected)}
                  </span>
                </div>

                <div>
                  <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Proposal</p>
                  <p className="text-[13px] text-zinc-400 leading-relaxed">{selected.description}</p>
                </div>

                <div className="pt-2 border-t border-zinc-800/50">
                  <p className="text-[10px] text-zinc-600 font-mono">
                    Bid #{selected.id} &middot; Project #{selected.projectId}
                  </p>
                  <a
                    href={`https://www.freelancer.com/projects/${selected.projectId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-violet-400 hover:text-violet-300 mt-1 inline-block"
                  >
                    View on Freelancer.com
                  </a>
                </div>
              </div>
            ) : (
              <div className="card p-8 text-center">
                <p className="text-sm text-zinc-600">Select a bid to view details</p>
              </div>
            )}
          </div>
        </div>
      )}
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
