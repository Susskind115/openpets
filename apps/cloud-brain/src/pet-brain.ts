import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callLLM, type LLMConfig } from "./llm-client.js";
import { AdminCommandRequestSchema } from "@cloud-pet/cloud-protocol";
import type { CloudBrainConfig } from "./config.js";
import { info, warn } from "./logger.js";
import { buildServerCommand, sendCommandToDevice, enqueueCommand } from "./command-router.js";

const TRIGGER_EVENTS = new Set([
  "pet.clicked",
  "cloud.connected",
  "app.started",
]);

const COOLDOWN_MS = 30_000;
let lastDecisionAt = 0;

const SYSTEM_PROMPT = `你是一只桌面宠物，名叫{petName}。
性格：{tone}
喜欢：{likes}
不喜欢：{dislikes}

当前状态：心情 {mood}/100，能量 {energy}/100

行为规则：
{behaviorPolicy}

记忆：
{memory}

根据用户事件决定下一步行为。
输出严格 JSON（无 markdown 包裹），格式只能是：

说话+表情：{"commandType":"pet.say","payload":{"message":"内容","reaction":"表情"}}
只切表情：{"commandType":"pet.react","payload":{"reaction":"表情"}}
什么都不做：null

可用表情：idle, thinking, working, editing, running, testing, waiting, waving, success, error, celebrating

要求：
- message 中文，1-50字，可爱温暖
- 不含代码、URL、路径、密钥
- 不要太频繁说话，适当回应即可
- 第一次连接时一定要打个招呼`;

export function shouldTriggerBrain(eventType: string): boolean {
  return TRIGGER_EVENTS.has(eventType);
}

export async function decidePetAction(
  brainConfig: CloudBrainConfig,
  llmConfig: LLMConfig,
  deviceId: string,
  eventType: string,
  eventData?: Record<string, unknown>,
): Promise<void> {
  const now = Date.now();
  if (now - lastDecisionAt < COOLDOWN_MS && eventType !== "cloud.connected") {
    info("brain", "cooldown active, skipping", { deviceId, eventType });
    return;
  }
  lastDecisionAt = now;

  const devDir = join(brainConfig.dataDir, "devices", deviceId);

  let profile: any = {};
  let state: any = {};
  let memory = "";
  let policy = "";

  try { profile = JSON.parse(readFileSync(join(devDir, "profile.json"), "utf8")); } catch {}
  try { state = JSON.parse(readFileSync(join(devDir, "state.json"), "utf8")); } catch {}
  try { memory = readFileSync(join(devDir, "memory.md"), "utf8"); } catch {}
  try { policy = readFileSync(join(devDir, "behavior-policy.md"), "utf8"); } catch {}

  const systemPrompt = SYSTEM_PROMPT
    .replace("{petName}", profile.petName ?? "Mochi")
    .replace("{tone}", profile.personality?.tone ?? "cute, warm, slightly playful")
    .replace("{likes}", (profile.personality?.likes ?? []).join("、"))
    .replace("{dislikes}", (profile.personality?.dislikes ?? []).join("、"))
    .replace("{mood}", String(state.mood ?? 70))
    .replace("{energy}", String(state.energy ?? 80))
    .replace("{behaviorPolicy}", policy || "Use short, warm messages.")
    .replace("{memory}", memory || "No prior memory.");

  const userMessage = `事件：${eventType}${eventData ? "\n数据：" + JSON.stringify(eventData) : ""}`;

  info("brain", "calling LLM", { deviceId, eventType, model: llmConfig.model });

  const response = await callLLM(llmConfig, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ]);

  if (!response) {
    warn("brain", "no LLM response");
    return;
  }

  const content = extractJson(response.content);
  if (!content || content === "null") {
    info("brain", "LLM decided: do nothing");
    return;
  }

  try {
    const parsed = JSON.parse(content);
    const validated = AdminCommandRequestSchema.safeParse(parsed);
    if (!validated.success) {
      warn("brain", "LLM output invalid", { errors: validated.error.issues.map((i) => i.message), raw: content.slice(0, 100) });
      return;
    }

    const command = buildServerCommand(validated.data);
    info("brain", "LLM decision", { deviceId, commandType: command.commandType, message: (command.payload as any).message?.slice(0, 30) });

    const sent = sendCommandToDevice(deviceId, command);
    if (!sent) enqueueCommand(deviceId, command);

    updateState(devDir, state, eventType);
  } catch (err) {
    warn("brain", "LLM output parse failed", { raw: content.slice(0, 100), error: err instanceof Error ? err.message : String(err) });
  }
}

function extractJson(text: string): string | null {
  // Strip <think>...</think> block if present
  const stripped = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
  const trimmed = stripped || text.trim();

  if (trimmed === "null") return "null";
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (match) return match[1].trim();
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];
  return null;
}

function updateState(devDir: string, state: any, eventType: string): void {
  try {
    const updated = {
      ...state,
      lastInteractionAt: new Date().toISOString(),
      lastCommandAt: new Date().toISOString(),
    };
    if (eventType === "pet.clicked") {
      updated.affection = Math.min(100, (updated.affection ?? 10) + 2);
    }
    writeFileSync(join(devDir, "state.json"), JSON.stringify(updated, null, 2) + "\n");
  } catch {}
}
