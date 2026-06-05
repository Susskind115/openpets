import type { FastifyInstance } from "fastify";
import { AdminCommandRequestSchema } from "@cloud-pet/cloud-protocol";
import type { CloudBrainConfig } from "./config.js";
import { info, warn } from "./logger.js";
import { getAllConnectedDevices } from "./state-store.js";
import { buildServerCommand, sendCommandToDevice, enqueueCommand, getConnection } from "./command-router.js";

export function registerHttpRoutes(app: FastifyInstance, config: CloudBrainConfig): void {
  app.get("/health", async () => {
    return { ok: true, service: "cloud-brain", version: "0.1.0" };
  });

  app.post("/v1/pair", async (request, reply) => {
    if (!config.devMode) {
      return reply.status(501).send({ error: "Pairing only available in dev mode for v0.1." });
    }

    const body = request.body as { deviceName?: string; clientVersion?: string };
    info("http", "pair request", { deviceName: body.deviceName, clientVersion: body.clientVersion });

    return {
      deviceId: "dev-local",
      deviceToken: "dev-token",
      wsUrl: `ws://${config.host}:${config.port}/v1/devices/dev-local/ws`,
    };
  });

  app.post("/v1/devices/:deviceId/commands", async (request, reply) => {
    const adminKey = request.headers["x-dev-admin-key"];
    if (adminKey !== config.adminKey) {
      return reply.status(403).send({ error: "Invalid admin key." });
    }

    const { deviceId } = request.params as { deviceId: string };
    const parsed = AdminCommandRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid command.", details: parsed.error.issues });
    }

    const command = buildServerCommand(parsed.data);
    info("http", "command received", { deviceId, commandId: command.commandId, commandType: command.commandType });

    const sent = sendCommandToDevice(deviceId, command);
    if (!sent) {
      enqueueCommand(deviceId, command);
      return { queued: true, commandId: command.commandId, reason: "device offline" };
    }

    return { sent: true, commandId: command.commandId };
  });

  app.get("/v1/devices", async () => {
    return { devices: getAllConnectedDevices() };
  });

  app.post("/v1/devices/:deviceId/events", async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };
    info("http", "event received via HTTP", { deviceId, body: request.body });
    return { ok: true };
  });
}
