const prefix = "[cloud-brain]";

export function info(scope: string, message: string, fields?: Record<string, unknown>): void {
  const extra = fields ? " " + JSON.stringify(fields) : "";
  console.log(`${prefix} [${scope}] ${message}${extra}`);
}

export function warn(scope: string, message: string, fields?: Record<string, unknown>): void {
  const extra = fields ? " " + JSON.stringify(fields) : "";
  console.warn(`${prefix} [${scope}] WARN ${message}${extra}`);
}

export function error(scope: string, message: string, err?: unknown): void {
  const extra = err instanceof Error ? ` ${err.message}` : err ? ` ${String(err)}` : "";
  console.error(`${prefix} [${scope}] ERROR ${message}${extra}`);
}
