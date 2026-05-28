import {
  debug as telemetryDebug,
  error as telemetryError,
  info as telemetryInfo,
  warn as telemetryWarn,
} from "@navix/shared-ts";

const toMessage = (message: string, error?: unknown) => {
  if (error === undefined) {
    return message;
  }
  if (error instanceof Error) {
    return `${message}: ${error.message}`;
  }
  if (typeof error === "string") {
    return `${message}: ${error}`;
  }
  try {
    return `${message}: ${JSON.stringify(error)}`;
  } catch {
    return `${message}: [unserializable]`;
  }
};

export const log = {
  debug(message: string, error?: unknown): void {
    void telemetryDebug(toMessage(message, error));
  },
  info(message: string, error?: unknown): void {
    void telemetryInfo(toMessage(message, error));
  },
  warn(message: string, error?: unknown): void {
    void telemetryWarn(toMessage(message, error));
  },
  error(message: string, error?: unknown): void {
    void telemetryError(toMessage(message, error));
  },
};
