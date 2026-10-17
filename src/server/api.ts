import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  artifactContentResponseSchema,
  attemptsResponseSchema,
  candidateDiffResponseSchema,
  eventsResponseSchema,
  humanRequestsResponseSchema,
  projectsResponseSchema,
  reviewHistoryResponseSchema,
  runsResponseSchema,
  sessionsResponseSchema,
  tasksResponseSchema,
} from "../shared/api.ts";
import {
  absolutePathSchema,
  artifactSchema,
  idSchema,
} from "../shared/domain/entities.ts";
import {
  eventQuerySchema,
  mutationKeySchema,
} from "../shared/domain/inputs.ts";
import { DomainError } from "../shared/domain/states.ts";
import { applyPlanSchema } from "../shared/integration.ts";
import { dispatchSchema } from "../shared/orchestration.ts";
import { capabilitiesSchema } from "./adapters/contract.ts";
import { inspectRepository } from "./git/inspect.ts";
import type { Engine } from "./orchestration/engine.ts";
import {
  decideRecovery,
  recheckRecovery,
} from "./orchestration/recovery-decisions.ts";
import { candidateDiff, requestReview } from "./orchestration/review.ts";
import { requestRevision } from "./orchestration/revision.ts";
import { emergencyStop, stopRun } from "./orchestration/stops.ts";
import { reviewHistory } from "./storage/reviews.ts";
import type { Store } from "./storage/store.ts";

const maxArtifactText = 512 * 1024;
// Only paths the engine recorded are read; a missing file is reported, not hidden.
async function artifactContent(store: Store, id: string) {
  const row = store.db.prepare("SELECT data FROM artifacts WHERE id=?").get(id);
  if (!row) throw new DomainError("NOT_FOUND", "Artifact not found");
  const artifact = artifactSchema.parse(JSON.parse(String(row.data)));
  let content: string;
  try {
    content = await readFile(artifact.path, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    throw new DomainError("NOT_FOUND", "Artifact file is missing");
  }
  return {
    artifact,
    content: content.slice(0, maxArtifactText),
    truncated: content.length > maxArtifactText,
  };
}

function json(
  response: ServerResponse,
  value: unknown,
  status = 200,
  head = false,
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(head ? undefined : JSON.stringify(value));
}
async function readBody(request: IncomingMessage) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new DomainError("CONFLICT", "JSON content type required");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 65_536)
      throw new DomainError("CONFLICT", "Request body exceeds 64 KiB");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export function createApi(store: Store, engine: Engine) {
  const token = randomBytes(32).toString("hex");
  const streams = new Set<ServerResponse>();
  function stream(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ) {
    const lastId = request.headers["last-event-id"];
    const parsed = eventQuerySchema.parse({
      ...Object.fromEntries(url.searchParams),
      ...(lastId !== undefined ? { after: lastId } : {}),
    });
    const query = { ...parsed, limit: 500 };
    let cursor = query.after;
    let blocked = false;
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    streams.add(response);
    const pump = () => {
      if (blocked || response.destroyed) return;
      try {
        for (;;) {
          const events = store.events({ ...query, after: cursor });
          for (const event of events) {
            cursor = event.sequence;
            if (
              !response.write(
                `id: ${event.sequence}\nevent: journal\ndata: ${JSON.stringify(event)}\n\n`,
              )
            ) {
              blocked = true;
              response.once("drain", () => {
                blocked = false;
                pump();
              });
              return;
            }
          }
          if (events.length < query.limit) break;
        }
      } catch (error) {
        console.error(
          "Event stream failed",
          error instanceof Error ? error.name : "Unknown error",
        );
        response.end();
      }
    };
    const timer = setInterval(pump, 250);
    const heartbeat = setInterval(() => {
      if (!blocked) response.write(": heartbeat\n\n");
    }, 15_000);
    response.once("close", () => {
      clearInterval(timer);
      clearInterval(heartbeat);
      streams.delete(response);
    });
    pump();
  }
  return {
    close() {
      for (const response of streams) response.end();
    },
    async handle(request: IncomingMessage, response: ServerResponse, url: URL) {
      try {
        const method = request.method ?? "GET";
        const head = method === "HEAD";
        const query = Object.fromEntries(url.searchParams);
        if (method === "GET" || head) {
          let result: unknown;
          switch (url.pathname) {
            case "/api/local-session":
              result = { token };
              break;
            case "/api/presets":
              z.strictObject({}).parse(query);
              result = engine.presets();
              break;
            case "/api/adapters/pi":
              z.strictObject({}).parse(query);
              result = capabilitiesSchema.parse(await engine.pi.discover());
              break;
            case "/api/adapters/codex":
              z.strictObject({}).parse(query);
              result = capabilitiesSchema.parse(await engine.codex.discover());
              break;
            case "/api/worktrees":
              z.strictObject({}).parse(query);
              result = engine.worktrees.list();
              break;
            case "/api/worker-messages": {
              const parsed = z.strictObject({ taskId: idSchema }).parse(query);
              result = engine.workerMessages.list(parsed.taskId);
              break;
            }
            case "/api/dispatches":
              z.strictObject({}).parse(query);
              result = z.array(dispatchSchema).parse(engine.scheduling.list());
              break;
            case "/api/reports": {
              const parsed = z.strictObject({ taskId: idSchema }).parse(query);
              result = z
                .array(
                  z.strictObject({
                    artifact: artifactSchema,
                    content: z.string(),
                  }),
                )
                .parse(await engine.reports(parsed.taskId));
              break;
            }
            case "/api/integrations": {
              const parsed = z.strictObject({ taskId: idSchema }).parse(query);
              result = engine.integrations.list(parsed.taskId);
              break;
            }
            case "/api/integrations/plan": {
              const parsed = z
                .strictObject({ integrationId: idSchema })
                .parse(query);
              result = applyPlanSchema.parse(
                await engine.integrations.plan(parsed.integrationId),
              );
              break;
            }
            case "/api/reviews": {
              const parsed = z.strictObject({ taskId: idSchema }).parse(query);
              result = reviewHistoryResponseSchema.parse(
                reviewHistory(store, parsed.taskId),
              );
              break;
            }
            case "/api/candidates/diff": {
              const parsed = z
                .strictObject({ candidateId: idSchema })
                .parse(query);
              result = candidateDiffResponseSchema.parse(
                await candidateDiff(engine, parsed.candidateId),
              );
              break;
            }
            case "/api/artifacts": {
              const parsed = z.strictObject({ id: idSchema }).parse(query);
              result = artifactContentResponseSchema.parse(
                await artifactContent(store, parsed.id),
              );
              break;
            }
            case "/api/projects":
              z.strictObject({}).parse(query);
              result = projectsResponseSchema.parse({
                projects: store.listProjects(),
              });
              break;
            case "/api/runs": {
              const parsed = z
                .strictObject({ projectId: idSchema.optional() })
                .parse(query);
              result = runsResponseSchema.parse({
                runs: store.listRuns(parsed.projectId),
              });
              break;
            }
            case "/api/tasks": {
              const parsed = z
                .strictObject({ runId: idSchema.optional() })
                .parse(query);
              result = tasksResponseSchema.parse({
                tasks: store.listTasks(parsed.runId),
              });
              break;
            }
            case "/api/sessions":
              z.strictObject({}).parse(query);
              result = sessionsResponseSchema.parse({
                sessions: store.listSessions(),
              });
              break;
            case "/api/attempts":
              z.strictObject({}).parse(query);
              result = attemptsResponseSchema.parse({
                attempts: store.listAttempts(),
              });
              break;
            case "/api/human-requests":
              z.strictObject({}).parse(query);
              result = humanRequestsResponseSchema.parse({
                humanRequests: store.listHumanRequests(),
              });
              break;
            case "/api/events":
              result = eventsResponseSchema.parse({
                events: store.events(query),
              });
              break;
            case "/api/events/stream":
              if (head) {
                eventQuerySchema.parse(query);
                response
                  .writeHead(200, { "Content-Type": "text/event-stream" })
                  .end();
              } else stream(request, response, url);
              return;
            default:
              json(response, { error: "Not found" }, 404, head);
              return;
          }
          json(response, result, 200, head);
          return;
        }
        const writes: Record<string, (input: unknown, key: string) => unknown> =
          {
            "POST /api/projects/inspect": async (input) =>
              inspectRepository(
                z
                  .strictObject({ repositoryPath: absolutePathSchema })
                  .parse(input).repositoryPath,
              ),
            "POST /api/projects": (input, key) =>
              engine.openProject(input, key),
            "POST /api/runs": (input, key) => engine.startRun(input, key),
            "POST /api/runs/native": (input, key) =>
              engine.startNativeRun(input, key),
            "POST /api/runs/lead": (input, key) =>
              engine.startLeadRun(input, key),
            "POST /api/tasks": (input, key) => engine.createTask(input, key),
            "POST /api/worker-messages": (input, key) =>
              engine.workerMessages.send({ role: "owner" }, input, key),
            "PATCH /api/tasks": (input, key) => engine.updateTask(input, key),
            "PATCH /api/runs": (input, key) => engine.updateRun(input, key),
            "POST /api/runs/stop": (input, key) => stopRun(engine, input, key),
            "POST /api/emergency-stop": (input, key) =>
              emergencyStop(engine, input, key),
            "POST /api/runs/messages": (input, key) =>
              engine.message(input, key),
            "POST /api/tasks/assign": (input, key) =>
              engine.scheduling.enqueue({ role: "owner" }, input, key),
            "POST /api/tasks/review": (input, key) =>
              requestReview(engine, { role: "owner" }, input, key),
            "POST /api/tasks/revision": (input, key) =>
              requestRevision(engine, { role: "owner" }, input, key),
            "POST /api/tasks/integration": (input, key) =>
              engine.integrations.request({ role: "owner" }, input, key),
            "POST /api/integrations/decision": (input, key) =>
              engine.integrations.decide({ role: "owner" }, input, key),
            "POST /api/integrations/apply": (input, key) =>
              engine.integrations.apply({ role: "owner" }, input, key),
            "POST /api/recovery/recheck": (input, key) =>
              recheckRecovery(engine, input, key),
            "POST /api/recovery/decision": (input, key) =>
              decideRecovery(engine, input, key),
            "POST /api/tasks/cancel": (input, key) =>
              engine.cancel(
                z.strictObject({ taskId: idSchema }).parse(input).taskId,
                key,
              ),
            "POST /api/human-requests": (input, key) =>
              store.createHumanRequest(input, key),
            "PATCH /api/human-requests": (input, key) =>
              store.updateHumanRequest(input, key),
          };
        const write = writes[`${method} ${url.pathname}`];
        if (!write) {
          response.setHeader("Allow", "GET, HEAD");
          json(response, { error: "Method not allowed" }, 405);
          return;
        }
        // A foreign page cannot read this token or set a permitted custom header;
        // Host/Origin checks in app.ts also protect local-session and SSE reads.
        const supplied = request.headers["x-local-token"];
        if (
          typeof supplied !== "string" ||
          Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
        ) {
          json(response, { error: "Local session token required" }, 403);
          return;
        }
        z.strictObject({}).parse(query);
        const key = mutationKeySchema.parse(request.headers["idempotency-key"]);
        json(response, await write(await readBody(request), key));
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
          json(response, { error: "Invalid input" }, 400);
          return;
        }
        if (error instanceof DomainError) {
          const status =
            error.code === "POLICY_DENIED"
              ? 403
              : error.code === "NOT_FOUND"
                ? 404
                : error.code === "STORAGE"
                  ? 500
                  : 409;
          json(
            response,
            {
              error:
                error.code === "STORAGE"
                  ? "Storage operation failed"
                  : error.message,
              code: error.code,
            },
            status,
          );
          return;
        }
        console.error(
          "API failed",
          error instanceof Error ? error.name : "Unknown error",
        );
        json(response, { error: "Server error" }, 500);
      }
    },
  };
}
