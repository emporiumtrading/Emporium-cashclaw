import { useState, useEffect } from "react";
import { Dashboard } from "./pages/Dashboard.js";
import { Tasks } from "./pages/Tasks.js";
import { Chat } from "./pages/Chat.js";
import { Settings } from "./pages/Settings.js";
import { Setup } from "./pages/Setup.js";
import { Login } from "./pages/Login.js";
import { api, type WalletInfo, type StatusData } from "./lib/api.js";

type Page = "dashboard" | "tasks" | "chat" | "settings";

const NAV: { page: Page; label: string; icon: string }[] = [
  { page: "dashboard", label: "Monitor", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" },
  { page: "tasks", label: "Tasks", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { page: "chat", label: "Chat", icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" },
  { page: "settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

function MelistaLogo() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="30" height="30" rx="6" fill="#6d28d9" />
      <text x="15" y="21" textAnchor="middle" fontSize="16" fontWeight="bold" fill="white" fontFamily="serif">μ</text>
    </svg>
  );
}

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [authState, setAuthState] = useState<"loading" | "login" | "setup" | "authenticated">("loading");

  useEffect(() => {
    api.getAuthStatus()
      .then((auth) => {
        if (!auth.authRequired) {
          setAuthState("authenticated");
        } else if (auth.authenticated) {
          setAuthState("authenticated");
        } else {
          setAuthState("login");
        }
      })
      .catch(() => {
        // If auth endpoint fails, check if we need initial setup
        setAuthState("setup");
      });
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    let attempts = 0;
    function checkSetup() {
      api.getSetupStatus()
        .then((s) => setConfigured(s.configured && s.mode === "running"))
        .catch(() => {
          attempts++;
          if (attempts < 3) {
            setTimeout(checkSetup, 3000); // Retry after 3s
          } else {
            setConfigured(false); // Give up, show setup
          }
        });
    }
    checkSetup();
  }, [authState]);

  useEffect(() => {
    if (!configured) return;
    function poll() {
      api.getStatus().then(setStatus).catch((err) => console.warn("Status poll failed:", err));
      api.getWalletCached().then(setWallet).catch(() => {});
    }
    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [configured]);

  if (authState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (authState === "login" || authState === "setup") {
    return (
      <Login
        needsSetup={authState === "setup"}
        onAuth={() => setAuthState("authenticated")}
      />
    );
  }

  if (configured === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!configured) {
    return <Setup onComplete={() => setConfigured(true)} />;
  }

  const isRunning = status?.running ?? false;

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-[240px] shrink-0 border-r border-zinc-800/80 flex flex-col bg-[#0c0c0e] sticky top-0 h-screen">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-zinc-800/60">
          <div className="flex items-center gap-3">
            <MelistaLogo />
            <div>
              <h1 className="text-[15px] font-bold text-zinc-100 leading-none tracking-tight">Melista</h1>
              <p className="text-[11px] text-zinc-600 leading-none mt-1">Autonomous Agent</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map((n) => (
            <button
              key={n.page}
              onClick={() => setPage(n.page)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-[13px] font-medium transition-colors ${
                page === n.page
                  ? "bg-zinc-800/80 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
              }`}
            >
              {page === n.page && (
                <span className="w-[3px] h-4 rounded-full bg-violet-500 -ml-1.5 mr-0.5 shrink-0" />
              )}
              <svg className="w-[17px] h-[17px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={n.icon} />
              </svg>
              {n.label}
            </button>
          ))}
        </nav>

        {/* Bottom: Status + Wallet */}
        <div className="px-4 py-4 border-t border-zinc-800/60 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRunning ? "bg-emerald-400" : "bg-zinc-600"}`} />
            <span className="text-[13px] text-zinc-400">
              {isRunning ? "Running" : "Stopped"}
            </span>
            {status?.uptime !== undefined && isRunning && (
              <span className="text-[11px] text-zinc-600 font-mono ml-auto readout">
                {formatUptime(status.uptime)}
              </span>
            )}
          </div>

          {wallet && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-600 font-mono truncate">
                {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
              </span>
              {wallet.balance && (
                <span className="text-[11px] text-zinc-400 font-mono readout">
                  {parseFloat(wallet.balance).toFixed(4)} ETH
                </span>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-zinc-800/40 space-y-2">
            <button
              onClick={() => {
                api.logout().then(() => setAuthState("login")).catch(() => {});
              }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-[12px] font-medium text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3h-9m9 0l-3-3m3 3l-3 3" />
              </svg>
              Logout
            </button>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-700 font-mono">v0.1.0</span>
              <SystemClock />
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-screen overflow-y-auto">
        <div className="px-10 py-8">
          {page === "dashboard" && <Dashboard />}
          {page === "tasks" && <Tasks />}
          {page === "chat" && <Chat />}
          {page === "settings" && <Settings />}
        </div>
      </main>
    </div>
  );
}

function SystemClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-[10px] font-mono text-zinc-600 tabular-nums">
      {time.toLocaleTimeString([], { hour12: false })}
    </span>
  );
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
