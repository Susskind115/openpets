import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { ClientMessageSchema } from "@cloud-pet/cloud-protocol";
import type { CloudBrainConfig } from "./config.js";
import { info, warn, error as logError } from "./logger.js";
import { registerDevice, unregisterDevice } from "./state-store.js";
import { registerConnection, unregisterConnection, drainPendingCommands, sendCommandToDevice } from "./command-router.js";
import { loadLLMConfig } from "./llm-client.js";
import { shouldTriggerBrain, decidePetAction } from "./pet-brain.js";

export function registerWsGateway(app: FastifyInstance, config: CloudBrainConfig): void {
  app.get("/v1/devices/:deviceId/ws", { websocket: true }, (socket, request: FastifyRequest<{ Params: { deviceId: string }; Querystring: { token?: string } }>) => {
    const { deviceId } = request.params;
    const token = extractToken(request);

    if (!validateDeviceAuth(config, deviceId, token)) {
      warn("ws", "auth failed", { deviceId });
      socket.close(4001, "Unauthorized");
      return;
    }

    info("ws", "client connected", { deviceId });

    registerDevice({ deviceId, connectedAt: new Date().toISOString() });
    registerConnection({
      deviceId,
      send: (data) => socket.send(data),
      close: () => socket.close(),
    });

    const welcome = JSON.stringify({
      type: "server.welcome",
      serverVersion: "0.1.0",
      deviceId,
      connectedAt: new Date().toISOString(),
    });
    socket.send(welcome);

    const pending = drainPendingCommands(deviceId);
    for (const cmd of pending) {
      sendCommandToDevice(deviceId, cmd);
    }

    socket.on("message", (raw: Buffer | string) => {
      try {
        const data = JSON.parse(raw.toString());
        const result = ClientMessageSchema.safeParse(data);
        if (!result.success) {
          warn("ws", "invalid client message", { deviceId, errors: result.error.issues.map((i) => i.message) });
          return;
        }

        const msg = result.data;

        if (msg.type === "client.hello") {
          info("ws", "client hello", { deviceId, platform: msg.payload.platform, appVersion: msg.payload.appVersion });
        } else if (msg.type === "client.event") {
          info("ws", "client event", { deviceId, eventType: msg.payload.eventType });
          if (shouldTriggerBrain(msg.payload.eventType)) {
            const llmConfig = loadLLMConfig();
            void decidePetAction(config, llmConfig, deviceId, msg.payload.eventType, msg.payload.data);
          }
        } else if (msg.type === "client.ack") {
          info("ws", "client ack", { deviceId, commandId: msg.payload.commandId, status: msg.payload.status });
        }
      } catch (err) {
        warn("ws", "message parse error", { deviceId, error: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on("close", () => {
      info("ws", "client disconnected", { deviceId });
      unregisterConnection(deviceId);
      unregisterDevice(deviceId);
    });

    socket.on("error", (err: Error) => {
      logError("ws", "socket error", err);
      unregisterConnection(deviceId);
      unregisterDevice(deviceId);
    });
  });
}

function extractToken(request: FastifyRequest<{ Querystring: { token?: string } }>): string | null {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const queryToken = request.query.token;
  if (typeof queryToken === "string") return queryToken;
  return null;
}

function validateDeviceAuth(config: CloudBrainConfig, deviceId: string, token: string | null): boolean {
  if (config.devMode) {
    return token === "dev-token" && deviceId === "dev-local";
  }
  return false;
}
