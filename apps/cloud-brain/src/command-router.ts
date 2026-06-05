import { randomUUID } from "node:crypto";
import type { CloudCommand, AdminCommandRequest } from "@cloud-pet/cloud-protocol";
import { info, warn } from "./logger.js";

export function buildServerCommand(request: AdminCommandRequest): CloudCommand {
  const base = {
    type: "server.command" as const,
    commandId: `cmd_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    ttlMs: 30_000,
  };

  switch (request.commandType) {
    case "pet.say":
      return { ...base, commandType: "pet.say", payload: request.payload };
    case "pet.react":
      return { ...base, commandType: "pet.react", payload: request.payload };
    case "pet.combo":
      return { ...base, commandType: "pet.combo", payload: request.payload };
    case "pet.notify":
      return { ...base, commandType: "pet.notify", payload: request.payload };
  }
}

export interface DeviceConnection {
  deviceId: string;
  send: (data: string) => void;
  close: () => void;
}

const deviceConnections = new Map<string, DeviceConnection>();

export function registerConnection(conn: DeviceConnection): void {
  deviceConnections.set(conn.deviceId, conn);
  info("router", "connection registered", { deviceId: conn.deviceId });
}

export function unregisterConnection(deviceId: string): void {
  deviceConnections.delete(deviceId);
  info("router", "connection unregistered", { deviceId });
}

export function getConnection(deviceId: string): DeviceConnection | undefined {
  return deviceConnections.get(deviceId);
}

export function sendCommandToDevice(deviceId: string, command: CloudCommand): boolean {
  const conn = deviceConnections.get(deviceId);
  if (!conn) {
    warn("router", "device not connected", { deviceId, commandId: command.commandId });
    return false;
  }

  try {
    conn.send(JSON.stringify(command));
    info("router", "command sent", { deviceId, commandId: command.commandId, commandType: command.commandType });
    return true;
  } catch (err) {
    warn("router", "send failed", { deviceId, commandId: command.commandId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

const pendingQueues = new Map<string, CloudCommand[]>();
const MAX_PENDING = 20;

export function enqueueCommand(deviceId: string, command: CloudCommand): void {
  let queue = pendingQueues.get(deviceId);
  if (!queue) {
    queue = [];
    pendingQueues.set(deviceId, queue);
  }
  if (queue.length >= MAX_PENDING) queue.shift();
  queue.push(command);
}

export function drainPendingCommands(deviceId: string): CloudCommand[] {
  const queue = pendingQueues.get(deviceId);
  if (!queue || queue.length === 0) return [];
  pendingQueues.set(deviceId, []);
  return queue;
}
