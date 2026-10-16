import assert from "node:assert/strict";
import { startApp } from "../src/server/app.ts";
import { healthSchema } from "../src/shared/health.ts";

// Probe the real development and built-page serving paths without any harness calls.
for (const development of [true, false]) {
  const app = await startApp({ development, port: 0 });
  try {
    const health = await fetch(`${app.origin}/api/health`);
    assert.equal(health.status, 200);
    healthSchema.parse(await health.json());
    const page = await fetch(app.origin);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<title>Local Agent Orchestrator<\/title>/);
    const entries = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)];
    assert.ok(entries.length > 0);
    for (const entry of entries) {
      assert.ok(entry[1]);
      const script = await fetch(new URL(entry[1], app.origin));
      assert.equal(script.status, 200);
      assert.match(script.headers.get("content-type") ?? "", /javascript/);
      assert.ok((await script.text()).length > 0);
    }
    console.log(
      `${development ? "Development" : "Production"} launch, health, HTML and script: passed (${app.origin})`,
    );
  } finally {
    await app.close();
  }
}
