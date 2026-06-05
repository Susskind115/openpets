import { readFileSync, statSync, watchFile, readdirSync } from "node:fs";
import { join } from "node:path";
import { AdminCommandRequestSchema } from "@cloud-pet/cloud-protocol";
import type { CloudBrainConfig } from "./config.js";
import { info, warn, error as logError } from "./logger.js";
import { buildServerCommand, sendCommandToDevice, enqueueCommand } from "./command-router.js";

const fileOffsets = new Map<string, number>();

export function startOutboxWatcher(config: CloudBrainConfig): void {
  const outboxDir = join(config.dataDir, "outbox");
  info("outbox", "watching", { dir: outboxDir });

  const files = readdirSync(outboxDir).filter((f) => f.endsWith(".jsonl"));
  for (const file of files) {
    const filePath = join(outboxDir, file);
    initFileWatch(filePath);
  }
}

function initFileWatch(filePath: string): void {
  try {
    const stat = statSync(filePath);
    fileOffsets.set(filePath, stat.size);
  } catch {
    fileOffsets.set(filePath, 0);
  }

  watchFile(filePath, { interval: 500 }, (curr, prev) => {
    if (curr.size > prev.size) {
      processNewLines(filePath);
    }
  });

  info("outbox", "tracking file", { file: filePath });
}

function processNewLines(filePath: string): void {
  try {
    const stat = statSync(filePath);
    const offset = fileOffsets.get(filePath) ?? 0;

    if (stat.size <= offset) return;

    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    let currentOffset = 0;
    for (const line of lines) {
      const lineEnd = currentOffset + Buffer.byteLength(line + "\n", "utf8");
      if (currentOffset < offset) {
        currentOffset = lineEnd;
        continue;
      }

      const trimmed = line.trim();
      if (trimmed) {
        processOutboxLine(trimmed, filePath);
      }
      currentOffset = lineEnd;
    }

    fileOffsets.set(filePath, stat.size);
  } catch (err) {
    logError("outbox", "file read error", err);
  }
}

function processOutboxLine(line: string, filePath: string): void {
  try {
    const raw = JSON.parse(line);
    const parsed = AdminCommandRequestSchema.safeParse(raw);
    if (!parsed.success) {
      warn("outbox", "invalid line", { file: filePath, errors: parsed.error.issues.map((i) => i.message) });
      return;
    }

    const deviceId = extractDeviceIdFromPath(filePath);
    const command = buildServerCommand(parsed.data);
    info("outbox", "command from outbox", { deviceId, commandId: command.commandId, commandType: command.commandType });

    const sent = sendCommandToDevice(deviceId, command);
    if (!sent) {
      enqueueCommand(deviceId, command);
    }
  } catch (err) {
    warn("outbox", "line parse error", { file: filePath, error: err instanceof Error ? err.message : String(err) });
  }
}

function extractDeviceIdFromPath(filePath: string): string {
  const filename = filePath.split("/").pop() ?? filePath.split("\\").pop() ?? "";
  return filename.replace(/\.jsonl$/, "");
}
