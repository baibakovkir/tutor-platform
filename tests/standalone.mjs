// Runs the complete integration suite against the packaged release, including a
// real process restart while the fixture room and both identities remain alive.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const release = resolve(process.argv[2] || "/tmp/tutor-package-check");
if (
  !process.env.DATABASE_URL ||
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.AUTH_URL || "").hostname,
  )
)
  throw Error("A local test database and AUTH_URL are required.");
let server,
  log = "";
async function stop() {
  if (!server || server.exitCode !== null) return;
  const old = server;
  old.kill("SIGTERM");
  await new Promise((resolve) => {
    const t = setTimeout(() => old.kill("SIGKILL"), 10000);
    old.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
async function start() {
  server = spawn(process.execPath, [release + "/server.js"], {
    env: { ...process.env, PORT: "3000", HOSTNAME: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => {
    log = (log + d).slice(-12000);
  });
  server.stderr.on("data", (d) => {
    log = (log + d).slice(-12000);
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch("http://localhost:3000/api/healthz")).ok) return;
    } catch {}
    if (server.exitCode !== null) break;
    await delay(500);
  }
  throw Error("Standalone server failed: " + log);
}
try {
  await start();
  const suite = spawn(process.execPath, ["tests/integration.mjs"], {
    env: { ...process.env, TUTOR_TEST_RESTART: "1" },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  suite.on("message", async (message) => {
    if (message?.type === "restart") {
      try {
        await stop();
        await start();
        suite.send("ready");
      } catch (e) {
        console.error(e);
        suite.send("failed");
      }
    }
  });
  const code = await new Promise((resolve) => suite.on("exit", resolve));
  if (code !== 0) {
    console.error(log);
    process.exitCode = code || 1;
  }
} finally {
  await stop();
}
