import { applyExternalPetReaction, applyExternalPetSay } from "../default-pet-controller.js";
import { debug, info, warn } from "../logger.js";
import { validateSpeechMessage, PET_REACTIONS, type PetReaction } from "@cloud-pet/cloud-protocol";

const ALLOWED_COMMANDS = new Set(["pet.say", "pet.react", "pet.combo", "pet.notify"]);

export function routeCloudCommand(command: any): "ok" | "error" | "ignored" | "expired" {
  if (!command || typeof command !== "object") return "error";
  if (!ALLOWED_COMMANDS.has(command.commandType)) {
    warn("cloud-router", "unknown command type", { commandType: command.commandType });
    return "error";
  }

  if (command.ttlMs && command.createdAt) {
    const created = new Date(command.createdAt).getTime();
    if (Date.now() - created > command.ttlMs) {
      debug("cloud-router", "command expired", { commandId: command.commandId });
      return "expired";
    }
  }

  const payload = command.payload;
  if (!payload || typeof payload !== "object") return "error";

  try {
    switch (command.commandType) {
      case "pet.say":
        return handleSay(payload);
      case "pet.react":
        return handleReact(payload);
      case "pet.combo":
        return handleCombo(payload);
      case "pet.notify":
        return handleNotify(payload);
      default:
        return "error";
    }
  } catch (err) {
    warn("cloud-router", "command execution error", { error: err instanceof Error ? err.message : String(err) });
    return "error";
  }
}

function handleSay(payload: any): "ok" | "error" {
  const validation = validateSpeechMessage(payload.message ?? "");
  if (!validation.ok) {
    warn("cloud-router", "speech rejected", { reason: validation.reason });
    return "error";
  }

  const reaction = isValidReaction(payload.reaction) ? payload.reaction : undefined;
  const result = applyExternalPetSay(validation.message, reaction);
  info("cloud-router", "pet.say applied", { shown: result.shown, reaction });
  return "ok";
}

function handleReact(payload: any): "ok" | "error" {
  if (!isValidReaction(payload.reaction)) {
    warn("cloud-router", "invalid reaction", { reaction: payload.reaction });
    return "error";
  }

  const result = applyExternalPetReaction(payload.reaction);
  info("cloud-router", "pet.react applied", { reaction: payload.reaction, shown: result.shown });
  return "ok";
}

function handleCombo(payload: any): "ok" | "error" {
  const reaction = isValidReaction(payload.reaction) ? payload.reaction : undefined;

  if (reaction) {
    applyExternalPetReaction(reaction);
  }

  if (payload.message) {
    const validation = validateSpeechMessage(payload.message);
    if (validation.ok) {
      applyExternalPetSay(validation.message, reaction);
    }
  }

  info("cloud-router", "pet.combo applied", { reaction, hasMessage: Boolean(payload.message) });
  return "ok";
}

function handleNotify(payload: any): "ok" | "error" {
  const validation = validateSpeechMessage(payload.message ?? "");
  if (!validation.ok) {
    warn("cloud-router", "notify speech rejected", { reason: validation.reason });
    return "error";
  }

  const reaction = isValidReaction(payload.reaction) ? payload.reaction : undefined;
  applyExternalPetSay(validation.message, reaction);
  info("cloud-router", "pet.notify applied", { reaction });
  return "ok";
}

function isValidReaction(value: unknown): value is PetReaction {
  return typeof value === "string" && (PET_REACTIONS as readonly string[]).includes(value);
}
