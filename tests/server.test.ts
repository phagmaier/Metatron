import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp } from "../src/server/app.ts";
import { healthSchema } from "../src/shared/health.ts";

let app: Awaited<ReturnType<typeof startApp>>;
let directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "lao-server-"));
  app = await startApp({
    development: false,
    port: 0,
    databasePath: join(directory, "state.sqlite"),
  });
});
after(async () => {
  await app?.close();
  await rm(directory, { recursive: true });
});

test("health is served by a loopback-only socket with a validated response", async () => {
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  const response = await fetch(`${app.origin}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(healthSchema.parse(await response.json()).milestone, "M4");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("same-origin requests are allowed", async () => {
  const response = await fetch(`${app.origin}/api/health`, {
    headers: { Origin: app.origin },
  });
  assert.equal(response.status, 200);
});

for (const origin of ["https://example.invalid", "null"]) {
  test(`foreign Origin ${origin} is refused`, async () => {
    const response = await fetch(`${app.origin}/api/health`, {
      headers: { Origin: origin },
    });
    assert.equal(response.status, 403);
  });
}

test("cross-site browser requests are refused even without an Origin", async () => {
  const response = await fetch(`${app.origin}/api/health`, {
    headers: { "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(response.status, 403);
});

for (const path of ["/api/local-session", "/api/events/stream", "/mcp"]) {
  test(`foreign browser requests cannot access ${path}`, async () => {
    for (const headers of [
      { Origin: "https://example.invalid" },
      { Origin: "null" },
      { "Sec-Fetch-Site": "cross-site" },
      { Host: "rebound.invalid" },
    ]) {
      // Fetch discards a forged Host on this Node version; use actual wire headers.
      const response = await new Promise<{
        status: number | undefined;
        cors: string | string[] | undefined;
      }>((resolve, reject) => {
        const req = request(
          `${app.origin}${path}`,
          { method: "HEAD", headers },
          (res) => {
            res.resume();
            res.on("end", () =>
              resolve({
                status: res.statusCode,
                cors: res.headers["access-control-allow-origin"],
              }),
            );
          },
        );
        req.on("error", reject);
        req.end();
      });
      assert.equal(response.status, 403);
      assert.equal(response.cors, undefined);
    }
  });
}

test("foreign Host is refused to guard against DNS rebinding", async () => {
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      `${app.origin}/api/health`,
      { headers: { Host: "example.invalid" } },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
});

test("malformed request URLs are rejected without crashing the server", async () => {
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(app.origin, { path: "http://[" }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 400);
  assert.equal((await fetch(`${app.origin}/api/health`)).status, 200);
});

test("health remains read only", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await fetch(`${app.origin}/api/health`, { method });
    assert.equal(response.status, 405);
  }
});

test("unknown API routes and private files are not served as a page", async () => {
  for (const path of [
    "/api/missing",
    "/package.json",
    "/.env",
    "/src/server/main.ts",
    "/assets/%2e%2e%2fpackage.json",
  ]) {
    const response = await fetch(`${app.origin}${path}`);
    assert.equal(response.status, 404);
  }
});
