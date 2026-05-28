import * as tauriLog from "@tauri-apps/plugin-log";
import {
  createFrontendTelemetryLogger,
  LogLevel,
  normalizeEventName,
} from "@navix/shared-ts";

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

const telemetry = createFrontendTelemetryLogger({
  app: "client",
  appVersion: "unknown",
  sink: (record) => {
    const line = JSON.stringify(record);
    if (record.level === LogLevel.Debug) {
      return tauriLog.debug(line);
    }
    if (record.level === LogLevel.Warn) {
      return tauriLog.warn(line);
    }
    if (record.level === LogLevel.Error || record.level === LogLevel.Fatal) {
      return tauriLog.error(line);
    }
    return tauriLog.info(line);
  },
});

const logRaw = (level: LogLevel, message: string) =>
  telemetry.track("frontend.log.update", {
    level,
    payload: { message },
  });

export const log = {
  debug(message: string): void {
    void logRaw(LogLevel.Debug, message);
  },
  info(message: string): void {
    void logRaw(LogLevel.Info, message);
  },
  warn(message: string): void {
    void logRaw(LogLevel.Warn, message);
  },
  error(message: string): void {
    void logRaw(LogLevel.Error, message);
  },
  telemetry(
    level: LogLevel,
    event: string,
    payload: Record<string, unknown> = {},
  ): void {
    void telemetry.track(normalizeEventName(event), { level, payload });
  },
};
