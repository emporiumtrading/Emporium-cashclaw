import { startAgent } from "./agent.js";
import { createLogger } from "./logger.js";

const log = createLogger("main");

async function main() {
  log.info("Starting CashClaw...");

  const server = await startAgent();

  // Open browser
  const url = "http://localhost:3777";
  const { execFile: execFileCb } = await import("node:child_process");
  const opener = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "start"
      : "xdg-open";
  execFileCb(opener, [url], () => {});

  // Graceful shutdown
  const shutdown = () => {
    log.info("Shutting down...");
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
