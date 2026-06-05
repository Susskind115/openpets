import { app } from "electron";
import { randomUUID } from "node:crypto";
import { getAppStateSnapshot, updateCloudBrainState } from "../app-state.js";
import type { CloudBrainState } from "../app-state.js";
import { debug, info, warn, error as logError } from "../logger.js";
import { routeCloudCommand } from "./cloud-command-router.js";
import { createEventBuffer } from "./cloud-event-buffer.js";

export type CloudConnectionStatus = "disabled" | "disconnected" | "connecting" | "connected" | "error";

let socket: WebSocket | null = null;
let status: CloudConnectionStatus = "disabled";
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let reconnectAttempt = 0;
const BACKOFF = [1000, 2000, 5000, 15000, 30000];

const eventBuffer = createEventBuffer();

let statusChangeListeners: Array<(s: CloudConnectionStatus) => void> = [];

export function onCloudStatusChange(listener: (s: CloudConnectionStatus) => void): void {
  statusChangeListeners.push(listener);
}

function setStatus(next: CloudConnectionStatus): void {
  if (status === next) return;
  status = next;
  info("cloud", "status changed", { status });
  for (const listener of statusChangeListeners) {
    try { listener(next); } catch {}
  }
}

export function getCloudStatus(): CloudConnectionStatus {
  return status;
}

export async function cloudBrainConnect(): Promise<void> {
  const state = getAppStateSnapshot();
  const config = state.cloudBrain;

  if (!config.enabled) {
    setStatus("disabled");
    return;
  }

  if (!config.deviceId || !config.deviceToken) {
    warn("cloud", "no device credentials, attempting pair");
    const paired = await pairWithServer(config.serverUrl);
    if (!paired) {
      setStatus("error");
      return;
    }
  }

  doConnect();
}

export function cloudBrainDisconnect(): void {
  clearTimers();
  if (socket) {
    try { socket.close(); } catch {}
    socket = null;
  }
  setStatus("disconnected");
  updateCloudBrainState({ lastDisconnectedAt: new Date().toISOString() });
}

export function cloudBrainSendEvent(eventType: string, data?: Record<string, unknown>): void {
  const msg = JSON.stringify({
    type: "client.event",
    messageId: `evt_${randomUUID()}`,
    sentAt: new Date().toISOString(),
    payload: { eventType, data },
  });

  if (socket && status === "connected") {
    try {
      socket.send(msg);
      return;
    } catch {}
  }
  eventBuffer.push(msg);
}

async function pairWithServer(serverUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(`${serverUrl}/v1/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceName: `${process.platform} Desktop`,
        clientVersion: app.getVersion(),
      }),
    });
    if (!resp.ok) {
      updateCloudBrainState({ lastError: `Pair failed: HTTP ${resp.status}` });
      return false;
    }
    const result = await resp.json() as { deviceId: string; deviceToken: string; wsUrl: string };
    updateCloudBrainState({
      deviceId: result.deviceId,
      deviceToken: result.deviceToken,
      lastError: undefined,
    });
    info("cloud", "paired", { deviceId: result.deviceId });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateCloudBrainState({ lastError: `Pair error: ${message}` });
    logError("cloud", "pair failed", err);
    return false;
  }
}

function doConnect(): void {
  const state = getAppStateSnapshot();
  const config = state.cloudBrain;
  if (!config.deviceId || !config.deviceToken) return;

  setStatus("connecting");
  clearTimers();

  const wsUrl = config.serverUrl.replace(/^http/, "ws") + `/v1/devices/${config.deviceId}/ws?token=${config.deviceToken}`;

  try {
    const conn = new WebSocket(wsUrl);
    socket = conn;

    conn.onopen = () => {
      setStatus("connected");
      reconnectAttempt = 0;
      updateCloudBrainState({ lastConnectedAt: new Date().toISOString(), lastError: undefined });

      conn.send(JSON.stringify({
        type: "client.hello",
        messageId: `msg_${randomUUID()}`,
        sentAt: new Date().toISOString(),
        payload: {
          deviceId: config.deviceId,
          appVersion: app.getVersion(),
          platform: process.platform,
          capabilities: {
            reactions: ["idle", "thinking", "working", "editing", "running", "testing", "waiting", "waving", "success", "error", "celebrating"],
            speech: true,
            notifications: false,
            clientEvents: ["app.started", "cloud.connected", "cloud.disconnected", "pet.reaction.changed", "pet.say.displayed", "heartbeat"],
          },
        },
      }));

      cloudBrainSendEvent("cloud.connected");
      flushEventBuffer(conn);
      startHeartbeat(conn);
    };

    conn.onmessage = (event: MessageEvent) => {
      const data = typeof event.data === "string" ? event.data : String(event.data);
      handleServerMessage(data, conn);
    };

    conn.onclose = () => {
      socket = null;
      setStatus("disconnected");
      updateCloudBrainState({ lastDisconnectedAt: new Date().toISOString() });
      scheduleReconnect();
    };

    conn.onerror = (err: Event) => {
      updateCloudBrainState({ lastError: "WebSocket error" });
      logError("cloud", "ws error", err);
    };
  } catch (err) {
    logError("cloud", "connect failed", err);
    setStatus("error");
    scheduleReconnect();
  }
}

function handleServerMessage(raw: string, conn: WebSocket): void {
  try {
    const msg = JSON.parse(raw);
    if (msg.type === "server.welcome") {
      info("cloud", "server welcome", { serverVersion: msg.serverVersion });
      return;
    }

    if (msg.type === "server.command") {
      debug("cloud", "command received", { commandId: msg.commandId, commandType: msg.commandType });
      const ackStatus = routeCloudCommand(msg);
      conn.send(JSON.stringify({
        type: "client.ack",
        messageId: `ack_${randomUUID()}`,
        sentAt: new Date().toISOString(),
        payload: { commandId: msg.commandId, status: ackStatus },
      }));
    }
  } catch (err) {
    warn("cloud", "message parse error", { error: err instanceof Error ? err.message : String(err) });
  }
}

function startHeartbeat(conn: WebSocket): void {
  heartbeatTimer = setInterval(() => {
    if (conn.readyState === WebSocket.OPEN) {
      conn.send(JSON.stringify({
        type: "client.event",
        messageId: `hb_${randomUUID()}`,
        sentAt: new Date().toISOString(),
        payload: { eventType: "heartbeat" },
      }));
    }
  }, 25_000);
  heartbeatTimer.unref?.();
}

function flushEventBuffer(conn: WebSocket): void {
  const events = eventBuffer.drain();
  for (const msg of events) {
    try { conn.send(msg); } catch {}
  }
}

function scheduleReconnect(): void {
  const state = getAppStateSnapshot();
  if (!state.cloudBrain.enabled) return;

  const delay = BACKOFF[Math.min(reconnectAttempt, BACKOFF.length - 1)];
  reconnectAttempt++;
  info("cloud", "scheduling reconnect", { attempt: reconnectAttempt, delayMs: delay });
  reconnectTimer = setTimeout(() => doConnect(), delay);
  reconnectTimer.unref?.();
}

function clearTimers(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

export function initCloudBrain(): void {
  const state = getAppStateSnapshot();
  if (state.cloudBrain.enabled && state.cloudBrain.autoConnect) {
    info("cloud", "auto-connecting on startup");
    void cloudBrainConnect();
  }
}
