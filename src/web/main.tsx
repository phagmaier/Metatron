import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { healthSchema } from "../shared/health.ts";
import "./style.css";

function App() {
  const [status, setStatus] = useState("Checking local server…");
  useEffect(() => {
    const controller = new AbortController();
    async function checkHealth() {
      try {
        const response = await fetch("/api/health", {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Health check returned ${response.status}`);
        healthSchema.parse(await response.json());
        setStatus("Local server online");
      } catch {
        if (!controller.signal.aborted)
          setStatus("Cannot reach the local server. Reload to retry.");
      }
    }
    void checkHealth();
    return () => controller.abort();
  }, []);

  return (
    <main>
      <p className="eyebrow">LOCAL WORKSPACE · M0</p>
      <h1>Local Agent Orchestrator</h1>
      <p className="intro">A local home for coordinating your coding agents.</p>
      <p className="status" role="status">
        {status}
      </p>
      <section aria-labelledby="project-title">
        <h2 id="project-title">Your projects start here</h2>
        <p>
          Project selection and saved runs are coming in the next milestones.
        </p>
        <p className="note">No harness sessions are connected or running.</p>
      </section>
    </main>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing application root");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
