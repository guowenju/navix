import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const failures = [];
const textExtensions = new Set([".rs", ".ts", ".tsx", ".js", ".mjs"]);
const ignoredDirs = new Set([".git", "node_modules", "dist", "target", ".pnpm-store"]);
const consoleAllowed = new Set([
  "apps/client/vite.config.ts",
  "packages/shared-ts/src/telemetry.ts",
]);
const directPluginLogAllowed = new Set([
  "apps/client/src/utils/logger.ts",
  "apps/client/src/components/layout/RootLayout.tsx",
]);

function rel(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function fail(file, line, message) {
  failures.push(`${file}:${line} ${message}`);
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/u).length;
}

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        files.push(...walk(join(dir, entry.name)));
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const path = join(dir, entry.name);
    if (textExtensions.has(extname(path))) {
      files.push(path);
    }
  }
  return files;
}

function isTelemetryEventName(value) {
  return /^[a-z0-9]+(?:\.[a-z0-9]+)*$/u.test(value);
}

function checkBuiltInFixtures() {
  const valid = ["api.request.completed", "auth.token.verify.started"];
  const invalid = [
    "auth.token_verify.started",
    "sync.compat-check.passed",
    "proxy.closeAll.start",
  ];
  for (const event of valid) {
    if (!isTelemetryEventName(event)) {
      throw new Error(`telemetry checker fixture should accept ${event}`);
    }
  }
  for (const event of invalid) {
    if (isTelemetryEventName(event)) {
      throw new Error(`telemetry checker fixture should reject ${event}`);
    }
  }
}

function checkEventNames(file, text) {
  const name = rel(file);
  const eventPatterns = [
    /\blogTelemetry\(\s*["'](?:debug|info|warn|error)["']\s*,\s*["']([^"']+)["']/gu,
    /\blogEvent\(\s*ObservabilityEvent\.[A-Za-z]+\s*,/gu,
    /\blog\.telemetry\(\s*LogLevel\.[A-Za-z]+\s*,\s*["']([^"']+)["']/gu,
    /emit_client_event\(\s*"([^"]+)"/gu,
    /build_server_record_raw\(\s*"([^"]+)"/gu,
    /build_server_record_with_context\(\s*"([^"]+)"/gu,
    /"event_name"\s*:\s*"([^"]+)"/gu,
    /\bevent_name:\s*["']([^"']+)["']/gu,
  ];

  for (const pattern of eventPatterns) {
    for (const match of text.matchAll(pattern)) {
      const event = match[1];
      if (!event) continue;
      if (!isTelemetryEventName(event)) {
        fail(name, lineOf(text, match.index), `telemetry event name must be lowercase dot segments: ${event}`);
      }
    }
  }
}

function checkNoConsole(file, text) {
  const name = rel(file);
  const isRuntimeSource =
    name.startsWith("apps/client/src/") || name.startsWith("apps/server/web/src/");
  if (!isRuntimeSource || consoleAllowed.has(name)) return;
  for (const match of text.matchAll(/\bconsole\.(?:log|debug|info|warn|error)\s*\(/gu)) {
    fail(name, lineOf(text, match.index), "do not add console.* runtime logging; use shared telemetry helpers");
  }
}

function checkNoDirectPluginLog(file, text) {
  const name = rel(file);
  if (!name.startsWith("apps/client/src/") || directPluginLogAllowed.has(name)) return;
  if (text.includes("@tauri-apps/plugin-log")) {
    fail(name, 1, "do not import @tauri-apps/plugin-log outside the logger adapter");
  }
}

function checkPayloadSystemFields(file, text) {
  const name = rel(file);
  const targets = [
    "packages/shared-ts/src/telemetry.ts",
    "packages/shared-rs/src/telemetry.rs",
    "apps/server/src/observability.rs",
    "apps/client/src-tauri/src/modules/telemetry.rs",
  ];
  if (!targets.includes(name)) return;
  for (const match of text.matchAll(/["'](?:ts|source|level)["']\s*:/gu)) {
    fail(name, lineOf(text, match.index), "telemetry payload must not write ts/source/level");
  }
}

function checkSensitiveLiteralPayload(file, text) {
  const name = rel(file);
  const sensitiveKeys = [
    "token",
    "refresh_token",
    "password",
    "authorization",
    "cookie",
  ];
  for (const key of sensitiveKeys) {
    const pattern = new RegExp(`BTreeMap::from\\([^)]*["']${key}["']|payload\\s*:\\s*\\{[^}]*\\b${key}\\b`, "isu");
    if (pattern.test(text)) {
      fail(name, 1, `telemetry payload must not include sensitive key ${key}`);
    }
  }
}

checkBuiltInFixtures();

for (const file of walk(root)) {
  if (!statSync(file).isFile()) continue;
  const text = readFileSync(file, "utf8");
  checkEventNames(file, text);
  checkNoConsole(file, text);
  checkNoDirectPluginLog(file, text);
  checkPayloadSystemFields(file, text);
  checkSensitiveLiteralPayload(file, text);
}

if (failures.length > 0) {
  console.error("Telemetry check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Telemetry check passed.");
