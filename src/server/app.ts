import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { healthSchema } from "../shared/health.ts";
import { createApi } from "./api.ts";
import { Engine } from "./orchestration/engine.ts";
import { appLocations } from "./storage/database.ts";
import { Store } from "./storage/store.ts";

const webRoot = new URL("../../dist/web/", import.meta.url);

export async function startApp(options: {
  development: boolean;
  port: number;
  databasePath?: string;
}) {
  const store = new Store(options.databasePath ?? appLocations().database);
  let engine: Engine | undefined;
  let api: ReturnType<typeof createApi> | undefined;
  let vite: ViteDevServer | undefined;
  let origin = "";
  const server = createServer((request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    // Check Host as well as Origin to reject DNS rebinding and foreign tabs.
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin !== undefined &&
        request.headers.origin !== origin) ||
      request.headers["sec-fetch-site"] === "cross-site"
    ) {
      response.writeHead(403).end("Local origin required");
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? "/", origin);
    } catch {
      response.writeHead(400).end("Invalid request URL");
      return;
    }
    if (url.origin !== origin) {
      response.writeHead(403).end("Local origin required");
      return;
    }
    if (url.pathname === "/api/health") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        response.writeHead(405).end("Method not allowed");
        return;
      }
      const health = healthSchema.parse({
        status: "ok",
        app: "Local Agent Orchestrator",
        milestone: "M2",
      });
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(
        request.method === "HEAD" ? undefined : JSON.stringify(health),
      );
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      if (!api) {
        response.writeHead(503).end("Starting");
        return;
      }
      void api.handle(request, response, url);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      response.writeHead(405).end("Method not allowed");
      return;
    }
    if (vite) {
      vite.middlewares(request, response);
      return;
    }
    // Only the built entry page and flat Vite assets are publicly readable.
    const path = url.pathname;
    const asset = /^\/assets\/[a-zA-Z0-9_-]+\.(js|css)$/.exec(path);
    if (path !== "/" && path !== "/index.html" && !asset) {
      response.writeHead(404).end("Not found");
      return;
    }
    const file = new URL(asset ? path.slice(1) : "index.html", webRoot);
    const contentType = asset
      ? asset[1] === "js"
        ? "text/javascript"
        : "text/css"
      : "text/html";
    readFile(file).then(
      (content) => {
        response.setHeader("Content-Type", `${contentType}; charset=utf-8`);
        response.end(request.method === "HEAD" ? undefined : content);
      },
      (error: unknown) => {
        const missing =
          error instanceof Error && "code" in error && error.code === "ENOENT";
        if (!missing) console.error("Static file read failed", error);
        response
          .writeHead(missing ? 404 : 500)
          .end(missing ? "Not found" : "Server error");
      },
    );
  });

  try {
    if (options.development) {
      const { createServer: createViteServer } = await import("vite");
      vite = await createViteServer({
        configFile: fileURLToPath(
          new URL("../../vite.config.ts", import.meta.url),
        ),
        server: {
          middlewareMode: true,
          host: "127.0.0.1",
          hmr: { server },
          cors: false,
        },
      });
    }
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      // There is intentionally no configurable public bind address.
      server.listen(options.port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing TCP address");
    origin = `http://127.0.0.1:${address.port}`;
    // An occupied app port must be rejected before recovering live attempts.
    store.recoverInterrupted();
    engine = new Engine(
      store,
      dirname(options.databasePath ?? appLocations().database),
    );
    api = createApi(store, engine);
  } catch (error) {
    await engine?.close();
    server.close();
    await vite?.close();
    store.close();
    throw error;
  }

  return {
    server,
    origin,
    async close() {
      api?.close();
      await engine?.close();
      await vite?.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
      store.close();
    },
  };
}
