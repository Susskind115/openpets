import { z } from "zod";

export const PET_REACTIONS = [
  "idle",
  "thinking",
  "working",
  "editing",
  "running",
  "testing",
  "waiting",
  "waving",
  "success",
  "error",
  "celebrating",
] as const;

export type PetReaction = (typeof PET_REACTIONS)[number];

export const PetReactionSchema = z.enum(PET_REACTIONS);

// --- Speech validation ---

const codePattern = /```|<script|function\s+\w+|=>|\b(class|import|export|const|let|var)\b/;
const urlOrPathPattern = /https?:\/\/|www\.|\/[\w.-]+\/[\w./-]+|[A-Za-z]:\\/;
const secretPattern = /(api[_-]?key|secret|token|password|passwd|BEGIN [A-Z ]+PRIVATE KEY)/i;

export function validateSpeechMessage(message: string): { ok: true; message: string } | { ok: false; reason: string } {
  const trimmed = message.trim();
  if (trimmed.length < 1) return { ok: false, reason: "Message cannot be empty." };
  if (trimmed.length > 140) return { ok: false, reason: "Message is too long (max 140 chars)." };
  if (/[\r\n]/.test(trimmed)) return { ok: false, reason: "Message must be single-line." };
  if (codePattern.test(trimmed)) return { ok: false, reason: "Message looks like code." };
  if (urlOrPathPattern.test(trimmed)) return { ok: false, reason: "Message contains a URL or path." };
  if (secretPattern.test(trimmed)) return { ok: false, reason: "Message looks secret-like." };
  return { ok: true, message: trimmed };
}

const SpeechMessageSchema = z.string().min(1).max(140).refine(
  (val) => validateSpeechMessage(val).ok,
  (val) => {
    const result = validateSpeechMessage(val);
    return { message: result.ok ? "" : result.reason };
  },
);

// --- Cloud Commands (server -> client) ---

export interface PetSayCommand {
  type: "server.command";
  commandId: string;
  commandType: "pet.say";
  createdAt: string;
  ttlMs?: number;
  payload: {
    message: string;
    reaction?: PetReaction;
  };
}

export interface PetReactCommand {
  type: "server.command";
  commandId: string;
  commandType: "pet.react";
  createdAt: string;
  ttlMs?: number;
  payload: {
    reaction: PetReaction;
  };
}

export interface PetComboCommand {
  type: "server.command";
  commandId: string;
  commandType: "pet.combo";
  createdAt: string;
  ttlMs?: number;
  payload: {
    reaction?: PetReaction;
    message?: string;
    durationMs?: number;
  };
}

export interface PetNotifyCommand {
  type: "server.command";
  commandId: string;
  commandType: "pet.notify";
  createdAt: string;
  ttlMs?: number;
  payload: {
    title?: string;
    message: string;
    reaction?: PetReaction;
  };
}

export type CloudCommand = PetSayCommand | PetReactCommand | PetComboCommand | PetNotifyCommand;

export const ALLOWED_COMMAND_TYPES = ["pet.say", "pet.react", "pet.combo", "pet.notify"] as const;
export type CloudCommandType = (typeof ALLOWED_COMMAND_TYPES)[number];

// --- Schemas for command payloads (used by server to validate admin input) ---

export const PetSayPayloadSchema = z.object({
  message: SpeechMessageSchema,
  reaction: PetReactionSchema.optional(),
});

export const PetReactPayloadSchema = z.object({
  reaction: PetReactionSchema,
});

export const PetComboPayloadSchema = z.object({
  reaction: PetReactionSchema.optional(),
  message: SpeechMessageSchema.optional(),
  durationMs: z.number().int().min(500).max(60_000).optional(),
});

export const PetNotifyPayloadSchema = z.object({
  title: z.string().min(1).max(60).optional(),
  message: SpeechMessageSchema,
  reaction: PetReactionSchema.optional(),
});

export const AdminCommandRequestSchema = z.discriminatedUnion("commandType", [
  z.object({ commandType: z.literal("pet.say"), payload: PetSayPayloadSchema }),
  z.object({ commandType: z.literal("pet.react"), payload: PetReactPayloadSchema }),
  z.object({ commandType: z.literal("pet.combo"), payload: PetComboPayloadSchema }),
  z.object({ commandType: z.literal("pet.notify"), payload: PetNotifyPayloadSchema }),
]);

export type AdminCommandRequest = z.infer<typeof AdminCommandRequestSchema>;

// --- Full server.command schema (for client-side validation of inbound WS messages) ---

export const ServerCommandSchema = z.object({
  type: z.literal("server.command"),
  commandId: z.string().min(1).max(120),
  commandType: z.enum(ALLOWED_COMMAND_TYPES),
  createdAt: z.string(),
  ttlMs: z.number().int().positive().optional(),
  payload: z.record(z.unknown()),
});

export const ServerWelcomeSchema = z.object({
  type: z.literal("server.welcome"),
  serverVersion: z.string(),
  deviceId: z.string(),
  connectedAt: z.string(),
});

export type ServerWelcome = z.infer<typeof ServerWelcomeSchema>;

// --- Client messages (client -> server) ---

export const CLIENT_EVENT_TYPES = [
  "app.started",
  "cloud.connected",
  "cloud.disconnected",
  "pet.visible",
  "pet.hidden",
  "pet.clicked",
  "pet.dragged",
  "pet.reaction.changed",
  "pet.say.displayed",
  "settings.updated",
  "heartbeat",
  "user.message",
] as const;

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export interface ClientHello {
  type: "client.hello";
  messageId: string;
  sentAt: string;
  payload: {
    deviceId: string;
    appVersion: string;
    platform: string;
    osRelease?: string;
    hostnameHash?: string;
    selectedPetId?: string;
    capabilities: {
      reactions: PetReaction[];
      speech: boolean;
      notifications: boolean;
      clientEvents: ClientEventType[];
    };
  };
}

export interface ClientEvent {
  type: "client.event";
  messageId: string;
  sentAt: string;
  payload: {
    eventType: ClientEventType;
    data?: Record<string, unknown>;
  };
}

export interface ClientAck {
  type: "client.ack";
  messageId: string;
  sentAt: string;
  payload: {
    commandId: string;
    status: "ok" | "error" | "ignored" | "expired";
    error?: string;
  };
}

export type ClientMessage = ClientHello | ClientEvent | ClientAck;

export const ClientHelloSchema = z.object({
  type: z.literal("client.hello"),
  messageId: z.string().min(1).max(120),
  sentAt: z.string(),
  payload: z.object({
    deviceId: z.string().min(1).max(64),
    appVersion: z.string(),
    platform: z.string(),
    osRelease: z.string().optional(),
    hostnameHash: z.string().optional(),
    selectedPetId: z.string().optional(),
    capabilities: z.object({
      reactions: z.array(PetReactionSchema),
      speech: z.boolean(),
      notifications: z.boolean(),
      clientEvents: z.array(z.enum(CLIENT_EVENT_TYPES)),
    }),
  }),
});

export const ClientEventSchema = z.object({
  type: z.literal("client.event"),
  messageId: z.string().min(1).max(120),
  sentAt: z.string(),
  payload: z.object({
    eventType: z.enum(CLIENT_EVENT_TYPES),
    data: z.record(z.unknown()).optional(),
  }),
});

export const ClientAckSchema = z.object({
  type: z.literal("client.ack"),
  messageId: z.string().min(1).max(120),
  sentAt: z.string(),
  payload: z.object({
    commandId: z.string().min(1).max(120),
    status: z.enum(["ok", "error", "ignored", "expired"]),
    error: z.string().optional(),
  }),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientHelloSchema,
  ClientEventSchema,
  ClientAckSchema,
]);

// --- Pair API ---

export interface PairRequest {
  deviceName: string;
  clientVersion: string;
}

export interface PairResponse {
  deviceId: string;
  deviceToken: string;
  wsUrl: string;
}

export const PairRequestSchema = z.object({
  deviceName: z.string().min(1).max(128),
  clientVersion: z.string().min(1).max(32),
});

// --- Outbox line (simplified command for file-based ingestion) ---

export const OutboxLineSchema = z.object({
  commandType: z.enum(ALLOWED_COMMAND_TYPES),
  payload: z.record(z.unknown()),
});

export type OutboxLine = z.infer<typeof OutboxLineSchema>;
