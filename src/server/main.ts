import { startApp } from "./app.ts";

try {
  const app = await startApp({
    development: !process.argv.includes("--production"),
    port: 4317,
  });
  console.log(`Local Agent Orchestrator: ${app.origin}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    app.close().catch((error: unknown) => {
      console.error("Shutdown failed", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  console.error("Startup failed", error);
  process.exitCode = 1;
}
