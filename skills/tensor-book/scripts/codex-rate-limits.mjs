#!/usr/bin/env node

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeWindow(name, window, capturedAt) {
  if (window === null || window === undefined) return null;
  if (typeof window !== "object") {
    throw new Error(`Codex returned an invalid ${name} rate-limit window.`);
  }

  const usedPercent = finiteNumber(window.usedPercent);
  const resetsAt = finiteNumber(window.resetsAt);
  const windowDurationMinutes = finiteNumber(window.windowDurationMins);
  const capturedAtEpochSeconds = capturedAt.getTime() / 1_000;

  if (usedPercent === null || usedPercent < 0 || usedPercent > 100) {
    throw new Error(`Codex returned an invalid ${name} used percentage.`);
  }
  if (windowDurationMinutes === null || windowDurationMinutes <= 0) {
    throw new Error(`Codex returned an invalid ${name} window duration.`);
  }
  if (resetsAt === null || resetsAt <= capturedAtEpochSeconds) {
    throw new Error(`Codex returned an expired or invalid ${name} reset time.`);
  }
  if (resetsAt > capturedAtEpochSeconds + windowDurationMinutes * 60) {
    throw new Error(`Codex returned an implausible ${name} reset time.`);
  }

  return {
    name,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMinutes,
    resetsAtEpochSeconds: resetsAt,
    resetsAt: new Date(resetsAt * 1_000).toISOString(),
  };
}

export function normalizeRateLimits(payload, capturedAt = new Date()) {
  if (!(capturedAt instanceof Date) || !Number.isFinite(capturedAt.getTime())) {
    throw new Error("A valid capture time is required.");
  }

  const rateLimits = payload?.rateLimits;
  if (!rateLimits || typeof rateLimits !== "object") {
    throw new Error("Codex did not return a rate-limit snapshot.");
  }

  const windows = [
    normalizeWindow("primary", rateLimits.primary, capturedAt),
    normalizeWindow("secondary", rateLimits.secondary, capturedAt),
  ].filter(Boolean);

  if (windows.length === 0) {
    throw new Error("Codex returned no usable rate-limit window.");
  }

  return {
    schemaVersion: 1,
    source: "codex-app-server-experimental",
    capturedAt: capturedAt.toISOString(),
    limitId: typeof rateLimits.limitId === "string" ? rateLimits.limitId : null,
    windows,
    paidExtensionAvailable: Boolean(rateLimits.credits?.hasCredits || rateLimits.credits?.unlimited),
    spendControlReached: rateLimits.spendControlReached === true,
  };
}

export function parseDeadline(argumentsList, environment = process.env) {
  const flagIndex = argumentsList.indexOf("--deadline-ms");
  const rawValue = flagIndex >= 0
    ? argumentsList[flagIndex + 1]
    : environment.TENSOR_BOOK_USAGE_PROBE_DEADLINE_MS;
  const deadlineMs = Number(rawValue);
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw new Error(
      "Set a positive probe deadline with --deadline-ms or TENSOR_BOOK_USAGE_PROBE_DEADLINE_MS.",
    );
  }
  return deadlineMs;
}

export function isDirectExecution(moduleUrl, argumentPath) {
  if (!argumentPath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argumentPath);
  } catch {
    return false;
  }
}

export function readRateLimits({
  deadlineMs,
  command = "codex",
  commandArguments = ["app-server", "--stdio"],
} = {}) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    return Promise.reject(new Error("A positive probe deadline is required."));
  }

  return new Promise((resolve, reject) => {
    const client = spawn(command, commandArguments, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const deadline = setTimeout(() => {
      finish(new Error(`Codex usage probe exceeded its ${deadlineMs} ms deadline.`));
    }, deadlineMs);

    function write(message) {
      client.stdin.write(`${JSON.stringify(message)}\n`);
    }

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      client.stdin.end();
      client.kill();
      if (error) reject(error);
      else resolve(result);
    }

    function handleMessage(message) {
      if (message?.id === 1) {
        if (message.error) {
          finish(new Error(
            `Codex app-server initialization failed: ${message.error.message ?? "unknown error"}`,
          ));
          return;
        }

        write({ method: "initialized", params: {} });
        write({ id: 2, method: "account/rateLimits/read", params: {} });
        return;
      }

      if (message?.id !== 2) return;
      if (message.error) {
        finish(new Error(`Codex rate-limit read failed: ${message.error.message ?? "unknown error"}`));
        return;
      }

      try {
        finish(null, normalizeRateLimits(message.result));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    }

    client.stdout.setEncoding("utf8");
    client.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          try {
            handleMessage(JSON.parse(line));
          } catch {
            // Ignore non-protocol output and continue waiting for the matching response.
          }
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    client.stderr.setEncoding("utf8");
    client.stderr.on("data", (chunk) => {
      stderrBuffer = `${stderrBuffer}${chunk}`.slice(-4_096);
    });

    client.on("error", (error) => {
      finish(new Error(`Unable to start the Codex usage probe: ${error.message}`));
    });

    client.on("close", (code) => {
      if (settled) return;
      const detail = stderrBuffer.trim();
      finish(new Error(
        detail || `Codex usage probe exited before returning data (code ${code ?? "unknown"}).`,
      ));
    });

    write({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "tensor-book-usage-probe",
          title: "Tensor Book Usage Probe",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

async function main() {
  try {
    const deadlineMs = parseDeadline(process.argv.slice(2));
    const snapshot = await readRateLimits({ deadlineMs });
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main();
}
