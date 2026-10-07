type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, scope: string, message: string, meta?: unknown) {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const output = level === "error" || level === "warn" ? console.error : console.log;
  if (meta === undefined) output(line);
  else output(line, meta instanceof Error ? meta : JSON.stringify(meta));
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, meta?: unknown) => {
      if (process.env.NODE_ENV !== "production") write("debug", scope, message, meta);
    },
    info: (message: string, meta?: unknown) => write("info", scope, message, meta),
    warn: (message: string, meta?: unknown) => write("warn", scope, message, meta),
    error: (message: string, meta?: unknown) => write("error", scope, message, meta),
  };
}
