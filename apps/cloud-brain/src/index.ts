import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { info, error as logError } from "./logger.js";
import { ensureDevDataDir } from "./state-store.js";
import { registerHttpRoutes } from "./http.js";
import { registerWsGateway } from "./ws-gateway.js";
import { startOutboxWatcher } from "./outbox-watcher.js";

async function main(): Promise<void> {
  const config = loadConfig();
  info("main", "starting", { host: config.host, port: config.port, devMode: config.devMode });

  if (config.devMode) {
    ensureDevDataDir(config);
  }

  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  registerHttpRoutes(app, config);
  registerWsGateway(app, config);

  await app.listen({ host: config.host, port: config.port });
  info("main", `Cloud Brain listening on http://${config.host}:${config.port}`);

  startOutboxWatcher(config);
}

main().catch((err) => {
  logError("main", "fatal", err);
  process.exit(1);
});
