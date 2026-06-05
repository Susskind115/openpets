import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CloudBrainConfig } from "./config.js";
import { info } from "./logger.js";

export interface DeviceProfile {
  deviceId: string;
  petName: string;
  species: string;
  personality: {
    tone: string;
    likes: string[];
    dislikes: string[];
  };
  user: {
    displayName: string;
  };
}

export interface DeviceState {
  mood: number;
  energy: number;
  hunger: number;
  affection: number;
  currentGoal: string;
  lastInteractionAt: string | null;
  lastCommandAt: string | null;
}

export interface ConnectedDevice {
  deviceId: string;
  connectedAt: string;
  lastHelloAt?: string;
  platform?: string;
  appVersion?: string;
}

const connectedDevices = new Map<string, ConnectedDevice>();

export function registerDevice(device: ConnectedDevice): void {
  connectedDevices.set(device.deviceId, device);
  info("state", "device registered", { deviceId: device.deviceId });
}

export function unregisterDevice(deviceId: string): void {
  connectedDevices.delete(deviceId);
  info("state", "device unregistered", { deviceId });
}

export function getConnectedDevice(deviceId: string): ConnectedDevice | undefined {
  return connectedDevices.get(deviceId);
}

export function getAllConnectedDevices(): ConnectedDevice[] {
  return [...connectedDevices.values()];
}

export function isDeviceConnected(deviceId: string): boolean {
  return connectedDevices.has(deviceId);
}

export function loadDeviceProfile(config: CloudBrainConfig, deviceId: string): DeviceProfile | null {
  const path = join(config.dataDir, "devices", deviceId, "profile.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as DeviceProfile;
}

export function loadDeviceState(config: CloudBrainConfig, deviceId: string): DeviceState | null {
  const path = join(config.dataDir, "devices", deviceId, "state.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as DeviceState;
}

export function saveDeviceState(config: CloudBrainConfig, deviceId: string, state: DeviceState): void {
  const dir = join(config.dataDir, "devices", deviceId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2) + "\n");
}

export function ensureDevDataDir(config: CloudBrainConfig): void {
  const devDir = join(config.dataDir, "devices", "dev-local");
  if (!existsSync(devDir)) mkdirSync(devDir, { recursive: true });

  const outboxDir = join(config.dataDir, "outbox");
  if (!existsSync(outboxDir)) mkdirSync(outboxDir, { recursive: true });

  const profilePath = join(devDir, "profile.json");
  if (!existsSync(profilePath)) {
    writeFileSync(profilePath, JSON.stringify({
      deviceId: "dev-local",
      petName: "Mochi",
      species: "desktop_pet",
      personality: {
        tone: "cute, warm, slightly playful",
        likes: ["being petted", "celebrating small wins", "quiet companionship"],
        dislikes: ["being too noisy", "spamming the user"],
      },
      user: { displayName: "Alex" },
    }, null, 2) + "\n");
  }

  const statePath = join(devDir, "state.json");
  if (!existsSync(statePath)) {
    writeFileSync(statePath, JSON.stringify({
      mood: 70,
      energy: 80,
      hunger: 30,
      affection: 10,
      currentGoal: "stay close and be friendly",
      lastInteractionAt: null,
      lastCommandAt: null,
    }, null, 2) + "\n");
  }

  const memoryPath = join(devDir, "memory.md");
  if (!existsSync(memoryPath)) {
    writeFileSync(memoryPath, "# Memory\n\n- The pet has just been created.\n- The desktop client is expected to connect through WebSocket.\n");
  }

  const policyPath = join(devDir, "behavior-policy.md");
  if (!existsSync(policyPath)) {
    writeFileSync(policyPath, "# Behavior Policy v0.1\n\nUse short, warm messages.\nDo not spam the desktop.\nPrefer reactions over speech for frequent events.\nUse `celebrating` for successful setup.\nUse `waiting` when user input is needed.\nUse `idle` when nothing is happening.\n");
  }

  const outboxFile = join(outboxDir, "dev-local.jsonl");
  if (!existsSync(outboxFile)) {
    writeFileSync(outboxFile, "");
  }
}
