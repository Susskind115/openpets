import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface CloudBrainConfig {
  host: string;
  port: number;
  adminKey: string;
  devMode: boolean;
  dataDir: string;
}

export function loadConfig(): CloudBrainConfig {
  const envPath = resolve(import.meta.dirname, "../.env");
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}

  return {
    host: process.env.CLOUD_BRAIN_HOST ?? "127.0.0.1",
    port: Number(process.env.CLOUD_BRAIN_PORT ?? "8787"),
    adminKey: process.env.CLOUD_BRAIN_ADMIN_KEY ?? "dev-admin-key",
    devMode: process.env.CLOUD_BRAIN_DEV_MODE === "1",
    dataDir: resolve(import.meta.dirname, "../data"),
  };
}
