import { useState, useEffect } from "react";
import { api, type WhopProduct, type WhopOrder } from "../lib/api.js";

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  trialing: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  past_due: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  cancelled: "text-zinc-500 bg-zinc-500/10 border-zinc-500/20",
  completed: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
};

export function Products() {
  const [products, setProducts] = useState<WhopProduct[]>([]);
  const [orders, setOrders] = useState<WhopOrder[]>([]);
  const [revenue, setRevenue] = useState<{ total: number; count: number }>({ total: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"products" | "orders">("products");

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      const [p, o, r] = await Promise.all([
        api.getWhopProducts().catch(() => ({ products: [], error: "Failed" })),
        api.getWhopOrders().catch(() => ({ orders: [], error: "Failed" })),
        api.getWhopRevenue().catch(() => ({ payments: [], total: 0, count: 0, error: "Failed" })),
      ]);
      setProducts(p.products);
      setOrders(o.orders);
      setRevenue({ total: r.total, count: r.count });
      if (p.error && p.error !== "Whop not configured") setError(p.error);
      else setError(null);
    } catch {
      setError("Failed to load Whop data");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-3xl font-bold text-zinc-100 tracking-tight mb-1.5">Products</h1>
        <p className="text-sm text-zinc-500">Whop passive income — products, orders, and revenue</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Products" value={products.length} />
        <StatCard label="Orders" value={orders.length} color="text-violet-400" />
        <StatCard label="Revenue" value={`$${revenue.total.toFixed(2)}`} color="text-emerald-400" />
        <StatCard label="Paid Orders" value={revenue.count} color="text-emerald-400" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[13px] text-red-400">
          {error}
        </div>
      )}

      {/* Info banner */}
      {products.length === 0 && !loading && (
        <div className="card p-6 text-center">
          <p className="text-lg text-zinc-300 mb-2">No products yet</p>
          <p className="text-sm text-zinc-500 mb-4">
            Melista will auto-create trending products during study sessions (every 30 min).
            You can also chat with Melista and ask it to create products via the Chat page.
          </p>
          <p className="text-xs text-zinc-600">
            Products are created on Whop and sold automatically. When a customer buys, Melista auto-delivers.
          </p>
        </div>
      )}

      {/* Tabs */}
      {(products.length > 0 || orders.length > 0) && (
        <>
          <div className="flex gap-1.5">
            <button
              onClick={() => setTab("products")}
              className={`px-4 py-2 rounded-md text-[13px] font-medium transition-colors ${tab === "products" ? "bg-violet-600 text-white" : "text-zinc-500 bg-zinc-800/50 hover:bg-zinc-800"}`}
            >
              Products ({products.length})
            </button>
            <button
              onClick={() => setTab("orders")}
              className={`px-4 py-2 rounded-md text-[13px] font-medium transition-colors ${tab === "orders" ? "bg-violet-600 text-white" : "text-zinc-500 bg-zinc-800/50 hover:bg-zinc-800"}`}
            >
              Orders ({orders.length})
            </button>
          </div>

          {tab === "products" && (
            <div className="space-y-3">
              {products.map((p) => (
                <div key={p.id} className="card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15px] font-semibold text-zinc-200">{p.title}</h3>
                      {p.description && (
                        <p className="text-[13px] text-zinc-500 mt-1 line-clamp-2">{p.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[11px] text-zinc-600 font-mono">{p.id}</span>
                        <span className="text-[11px] text-zinc-600">{formatDate(p.created_at)}</span>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider border ${
                      p.visibility === "visible" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-zinc-500 bg-zinc-500/10 border-zinc-500/20"
                    }`}>
                      {p.visibility}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "orders" && (
            <div className="space-y-3">
              {orders.length === 0 ? (
                <div className="card p-8 text-center">
                  <p className="text-sm text-zinc-600">No orders yet. Products are live — waiting for first purchase.</p>
                </div>
              ) : (
                orders.map((o) => (
                  <div key={o.id} className="card p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[14px] font-medium text-zinc-200">{o.product?.title ?? "Unknown Product"}</h3>
                        <p className="text-[12px] text-zinc-500 mt-0.5">
                          Customer: {o.user?.username ?? o.user?.id ?? "Anonymous"} &middot; {formatRelative(o.created_at)}
                        </p>
                        {o.metadata?.delivered === "true" && (
                          <p className="text-[11px] text-emerald-500 mt-1">Delivered at {o.metadata.delivered_at}</p>
                        )}
                      </div>
                      <span className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider border ${STATUS_COLORS[o.status] ?? STATUS_COLORS.active}`}>
                        {o.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {loading && (
        <div className="text-center py-20">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-zinc-600">Loading Whop data...</p>
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
