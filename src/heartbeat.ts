import WebSocket from "ws";
import type { MelistaConfig } from "./config.js";
import type { LLMProvider } from "./llm/types.js";
import type { Task } from "./moltlaunch/types.js";
import * as cli from "./moltlaunch/cli.js";
import { runAgentLoop, type LoopResult } from "./loop/index.js";
import { runStudySession } from "./loop/study.js";
import { storeFeedback } from "./memory/feedback.js";
import { appendLog } from "./memory/log.js";
import {
  createMultiMarketplace,
  type MultiMarketplace,
  type MarketplaceTask,
} from "./marketplaces/index.js";
import * as dbTasks from "./db/tasks.js";
import * as dbRevenue from "./db/revenue.js";
import * as dbClients from "./db/clients.js";

export interface HeartbeatState {
  running: boolean;
  activeTasks: Map<string, Task>;
  lastPoll: number;
  totalPolls: number;
  startedAt: number;
  events: ActivityEvent[];
  wsConnected: boolean;
  lastStudyTime: number;
  totalStudySessions: number;
}

export interface ActivityEvent {
  timestamp: number;
  type: "poll" | "loop_start" | "loop_complete" | "tool_call" | "feedback" | "error" | "ws" | "study";
  taskId?: string;
  message: string;
}

type EventListener = (event: ActivityEvent) => void;

const TERMINAL_STATUSES = new Set([
  "completed", "declined", "cancelled", "expired", "resolved", "disputed",
]);

const WS_URL = "wss://api.moltlaunch.com/ws";
const WS_INITIAL_RECONNECT_MS = 5_000;
const WS_MAX_RECONNECT_MS = 300_000; // 5 min cap
// When WS is connected, poll infrequently as a sync check
const WS_POLL_INTERVAL_MS = 120_000;
// Expire non-terminal tasks after 7 days to prevent memory leaks
const TASK_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export function createHeartbeat(
  config: MelistaConfig,
  llm: LLMProvider,
) {
  // Initialise multi-marketplace system
  const multiMarketplace: MultiMarketplace = createMultiMarketplace(
    config,
    config.marketplaces,
  );
  const activeMarketplaceCount = multiMarketplace.active.length;
  if (activeMarketplaceCount > 1) {
    appendLog(`Multi-marketplace enabled: ${multiMarketplace.active.map((a) => a.label).join(", ")}`);
  }
  const state: HeartbeatState = {
    running: false,
    activeTasks: new Map(),
    lastPoll: 0,
    totalPolls: 0,
    startedAt: 0,
    events: [],
    wsConnected: false,
    lastStudyTime: 0,
    totalStudySessions: 0,
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;
  let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let wsReconnectDelay = WS_INITIAL_RECONNECT_MS;
  let wsFailLogged = false;
  const processing = new Set<string>();
  const completedTasks = new Set<string>();
  // Track task+status combos to prevent duplicate processing from WS+poll overlap
  const processedVersions = new Map<string, string>();
  const listeners: EventListener[] = [];

  function emit(event: Omit<ActivityEvent, "timestamp">) {
    const full: ActivityEvent = { ...event, timestamp: Date.now() };
    state.events.push(full);
    if (state.events.length > 200) {
      state.events = state.events.slice(-200);
    }
    // Persist to SQLite
    appendLog(full.message, full.type, full.taskId);
    for (const fn of listeners) fn(full);
  }

  function onEvent(fn: EventListener) {
    listeners.push(fn);
  }

  // --- WebSocket ---

  function connectWs() {
    if (!state.running || !config.agentId) return;

    try {
      ws = new WebSocket(`${WS_URL}/${config.agentId}`);

      ws.on("open", () => {
        state.wsConnected = true;
        wsReconnectDelay = WS_INITIAL_RECONNECT_MS;
        wsFailLogged = false;
        emit({ type: "ws", message: "WebSocket connected" });
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            event: string;
            task?: Task;
            timestamp?: number;
          };

          if (msg.event === "connected") return;

          emit({ type: "ws", taskId: msg.task?.id, message: `WS event: ${msg.event}` });

          if (msg.task) {
            handleTaskEvent(msg.task);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on("close", () => {
        state.wsConnected = false;
        // Only log the first disconnect, suppress repeated failures
        if (!wsFailLogged) {
          emit({ type: "ws", message: "WebSocket disconnected — retrying in background" });
          wsFailLogged = true;
        }
        scheduleWsReconnect();
      });

      ws.on("error", (err: Error) => {
        state.wsConnected = false;
        if (!wsFailLogged) {
          emit({ type: "error", message: `WebSocket error: ${err.message}` });
          wsFailLogged = true;
        }
        ws?.close();
        scheduleWsReconnect();
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!wsFailLogged) {
        emit({ type: "error", message: `WebSocket connect failed: ${msg}` });
        wsFailLogged = true;
      }
      scheduleWsReconnect();
    }
  }

  function scheduleWsReconnect() {
    if (!state.running) return;
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(() => connectWs(), wsReconnectDelay);
    // Exponential backoff: 5s → 10s → 20s → 40s → ... → 5min cap
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_MAX_RECONNECT_MS);
  }

  function disconnectWs() {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (ws) {
      ws.removeAllListeners();
      ws.close();
      ws = null;
    }
    state.wsConnected = false;
  }

  // --- Task handling (shared by WS + poll) ---

  function handleTaskEvent(task: Task) {
    // Record task in database
    dbTasks.upsertTask({
      id: task.id,
      marketplace: "moltlaunch",
      global_id: task.id,
      client_address: task.clientAddress,
      description: task.task,
      status: task.status,
      category: task.category,
      quoted_price: task.quotedPriceWei,
    });

    // Track client
    if (task.clientAddress) {
      dbClients.upsertClient(task.clientAddress, "moltlaunch");
    }

    if (TERMINAL_STATUSES.has(task.status)) {
      if (task.status === "completed" && task.ratedScore !== undefined) {
        handleCompleted(task);
      }
      dbTasks.upsertTask({ id: task.id, status: task.status, completed_at: Date.now() });
      state.activeTasks.delete(task.id);
      processedVersions.delete(task.id);
      return;
    }

    // Dedup: skip if we already processed this exact task+status combo
    const version = `${task.id}:${task.status}`;
    if (processedVersions.get(task.id) === version && !processing.has(task.id)) {
      state.activeTasks.set(task.id, task);
      return;
    }

    if (processing.has(task.id)) return;

    if (task.status === "quoted" || task.status === "submitted") {
      state.activeTasks.set(task.id, task);
      processedVersions.set(task.id, version);
      return;
    }

    if (processing.size >= config.maxConcurrentTasks) return;

    state.activeTasks.set(task.id, task);
    processedVersions.set(task.id, version);
    processing.add(task.id);

    emit({ type: "loop_start", taskId: task.id, message: `Agent loop started (${task.status})` });

    runAgentLoop(llm, task, config)
      .then((result: LoopResult) => {
        const toolNames = result.toolCalls.map((tc) => tc.name).join(", ");
        emit({
          type: "loop_complete",
          taskId: task.id,
          message: `Loop done in ${result.turns} turn(s): [${toolNames}]`,
        });

        // Record tool actions in DB
        const hasQuote = result.toolCalls.some((tc) => tc.name === "quote_task");
        const hasDecline = result.toolCalls.some((tc) => tc.name === "decline_task");
        if (hasQuote) {
          dbRevenue.recordTaskQuoted();
          dbTasks.upsertTask({ id: task.id, status: "quoted", quoted_at: Date.now(), loop_turns: result.turns, tools_used: JSON.stringify(toolNames) });
        }
        if (hasDecline) {
          dbRevenue.recordTaskDeclined();
          dbTasks.upsertTask({ id: task.id, status: "declined" });
        }

        for (const tc of result.toolCalls) {
          emit({
            type: "tool_call",
            taskId: task.id,
            message: `${tc.name}(${JSON.stringify(tc.input).slice(0, 100)}) → ${tc.success ? "ok" : "err"}`,
          });
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: "error", taskId: task.id, message: `Loop error: ${msg}` });
      })
      .finally(() => {
        processing.delete(task.id);
      });
  }

  // --- Polling (fallback / sync check) ---

  async function tick() {
    try {
      const tasks = await cli.getInbox(config.agentId);
      state.lastPoll = Date.now();
      state.totalPolls++;

      emit({ type: "poll", message: `Polled inbox: ${tasks.length} task(s)` });

      for (const task of tasks) {
        handleTaskEvent(task);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "error", message: `Poll error: ${msg}` });
    }

    scheduleNext();
  }

  function handleCompleted(task: Task) {
    if (task.ratedScore === undefined) return;
    if (completedTasks.has(task.id)) return;
    completedTasks.add(task.id);

    storeFeedback({
      taskId: task.id,
      taskDescription: task.task,
      score: task.ratedScore,
      comments: task.ratedComment ?? "",
      timestamp: Date.now(),
    });

    // Record revenue in DB
    const priceEth = task.quotedPriceWei
      ? (parseInt(task.quotedPriceWei) / 1e18).toFixed(6)
      : "0";
    const priceUsd = parseFloat(priceEth) * 2050; // approximate ETH/USD
    const costUsd = 0.06; // LLM cost estimate per task

    dbTasks.upsertTask({
      id: task.id,
      status: "completed",
      completed_at: Date.now(),
      rated_score: task.ratedScore,
      rated_comment: task.ratedComment,
      revenue_eth: priceEth,
      revenue_usd: priceUsd,
      profit_usd: priceUsd - costUsd,
    });

    dbRevenue.recordTaskCompleted(priceUsd, priceEth, costUsd);

    if (task.clientAddress) {
      dbClients.recordClientCompletion(task.clientAddress, priceUsd, task.ratedScore);
    }

    emit({
      type: "feedback",
      taskId: task.id,
      message: `Completed — rated ${task.ratedScore}/5 — revenue $${priceUsd.toFixed(2)}`,
    });
  }

  function scheduleNext() {
    if (!state.running) return;

    // Expire stale non-terminal tasks to prevent memory leaks
    const now = Date.now();
    for (const [id, task] of state.activeTasks) {
      const taskTime = task.quotedAt ?? task.acceptedAt ?? task.submittedAt ?? state.startedAt;
      if (!processing.has(id) && now - taskTime > TASK_EXPIRY_MS) {
        state.activeTasks.delete(id);
        processedVersions.delete(id);
      }
    }

    // Check if we should study while idle
    void maybeStudy();

    // If WebSocket is connected, poll infrequently as a sync check
    if (state.wsConnected) {
      timer = setTimeout(() => void tick(), WS_POLL_INTERVAL_MS);
      return;
    }

    // Without WS, use normal polling intervals
    const hasUrgent = [...state.activeTasks.values()].some(
      (t) => t.status === "requested" || t.status === "revision" || t.status === "accepted",
    );

    const interval = hasUrgent
      ? config.polling.urgentIntervalMs
      : config.polling.intervalMs;

    timer = setTimeout(() => void tick(), interval);
  }

  let studying = false;

  async function maybeStudy() {
    if (!config.learningEnabled) return;
    if (studying) return;
    if (processing.size > 0) return;

    // Don't study if there are tasks needing action
    const hasUrgent = [...state.activeTasks.values()].some(
      (t) => t.status === "requested" || t.status === "revision" || t.status === "accepted",
    );
    if (hasUrgent) return;

    if (Date.now() - state.lastStudyTime < config.studyIntervalMs) return;

    studying = true;
    emit({ type: "study", message: "Starting study session..." });

    try {
      const result = await runStudySession(llm, config);
      state.lastStudyTime = Date.now();
      state.totalStudySessions++;

      emit({
        type: "study",
        message: `Study complete: ${result.topic} (${result.tokensUsed} tokens)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "error", message: `Study error: ${msg}` });
      // Avoid retrying immediately on failure
      state.lastStudyTime = Date.now();
    } finally {
      studying = false;
    }
  }

  // --- Multi-marketplace polling (non-Moltlaunch) ---

  let marketplaceTimer: ReturnType<typeof setTimeout> | null = null;
  const MARKETPLACE_POLL_INTERVAL_MS = 120_000; // Poll external marketplaces every 2 min

  function handleMarketplaceTask(mTask: MarketplaceTask) {
    // Skip non-actionable statuses
    if (mTask.status === "completed" || mTask.status === "cancelled" ||
        mTask.status === "expired" || mTask.status === "declined") {
      return;
    }

    // Skip if already being processed (dedup by globalId)
    if (processing.has(mTask.globalId)) return;

    const version = `${mTask.globalId}:${mTask.status}`;
    if (processedVersions.get(mTask.globalId) === version) return;

    // Skip "waiting" statuses
    if (mTask.status === "quoted" || mTask.status === "submitted") {
      processedVersions.set(mTask.globalId, version);
      return;
    }

    if (processing.size >= config.maxConcurrentTasks) return;

    processedVersions.set(mTask.globalId, version);
    processing.add(mTask.globalId);

    // Convert MarketplaceTask to the Task shape the agent loop expects
    const loopTask: Task = {
      id: mTask.globalId,
      agentId: config.agentId,
      clientAddress: mTask.client,
      task: mTask.description,
      status: mTask.status as Task["status"],
      budgetWei: mTask.budget,
      messages: mTask.messages?.map((m) => ({
        sender: m.role === "client" ? mTask.client : config.agentId,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
      result: mTask.previousResult,
    };

    // Store in activeTasks for the dashboard
    state.activeTasks.set(mTask.globalId, loopTask);

    emit({
      type: "loop_start",
      taskId: mTask.globalId,
      message: `[${mTask.marketplace}] Agent loop started (${mTask.status})`,
    });

    runAgentLoop(llm, loopTask, config)
      .then((result: LoopResult) => {
        const toolNames = result.toolCalls.map((tc) => tc.name).join(", ");
        emit({
          type: "loop_complete",
          taskId: mTask.globalId,
          message: `[${mTask.marketplace}] Loop done: ${result.turns} turn(s) [${toolNames}]`,
        });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: "error", taskId: mTask.globalId, message: `[${mTask.marketplace}] Loop error: ${msg}` });
      })
      .finally(() => {
        processing.delete(mTask.globalId);
        state.activeTasks.delete(mTask.globalId);
      });
  }

  async function tickMarketplaces() {
    // Skip if only Moltlaunch is active (handled by existing WS+poll)
    const externalAdapters = multiMarketplace.active.filter((a) => a.name !== "moltlaunch");
    if (externalAdapters.length === 0) return;

    try {
      const tasks = await multiMarketplace.pollAll();
      // Filter to only external marketplace tasks (Moltlaunch handled separately)
      const externalTasks = tasks.filter((t) => t.marketplace !== "moltlaunch");

      if (externalTasks.length > 0) {
        emit({
          type: "poll",
          message: `Multi-marketplace poll: ${externalTasks.length} task(s) from ${new Set(externalTasks.map((t) => t.marketplace)).size} platform(s)`,
        });
      }

      // Process max 2 tasks per poll to avoid overwhelming the server
      const toProcess = externalTasks.slice(0, 2);
      for (const task of toProcess) {
        handleMarketplaceTask(task);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "error", message: `Multi-marketplace poll error: ${msg}` });
    }

    scheduleMarketplacePoll();
  }

  function scheduleMarketplacePoll() {
    if (!state.running) return;
    marketplaceTimer = setTimeout(() => void tickMarketplaces(), MARKETPLACE_POLL_INTERVAL_MS);
  }

  function start() {
    if (state.running) return;
    state.running = true;
    state.startedAt = Date.now();
    // Don't study immediately on restart — wait one full interval
    if (state.lastStudyTime === 0) {
      state.lastStudyTime = Date.now();
    }
    emit({ type: "ws", message: "Heartbeat started" });
    connectWs();
    void tick();
    // Start external marketplace polling
    void tickMarketplaces();
  }

  function stop() {
    state.running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    disconnectWs();
    if (marketplaceTimer) {
      clearTimeout(marketplaceTimer);
      marketplaceTimer = null;
    }
    emit({ type: "ws", message: "Heartbeat stopped" });
  }

  return { state, start, stop, onEvent };
}

export type Heartbeat = ReturnType<typeof createHeartbeat>;
