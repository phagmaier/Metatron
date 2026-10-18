import { z } from "zod";
import { humanRequestSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  providerFailureKindSchema,
  providerFailureLabels,
  providerFailureSchema,
} from "../../shared/provider-failures.ts";
import { mutate } from "../storage/mutations.ts";
import type { Engine } from "./engine.ts";
import { notifyLead } from "./lead-run.ts";

const errorTypes =
  "'pi.session_error','codex.session_error','claude-code.session_error','opencode.session_error','fake.session_error'";
const kinds = "'auth','rate_limit','credits_exhausted','usage_limit'";

// Native events commit before shutdown. After a crash they still explain the
// blocker, but cannot establish that the process or its tools safely ended.
export function finishProviderFailure(
  engine: Engine,
  attemptId: string,
  safelyEnded: boolean,
) {
  const { store } = engine;
  const evidence = store.db
    .prepare(`
    SELECT id,session_id,payload FROM events WHERE attempt_id=?
      AND type IN (${errorTypes})
    ORDER BY sequence DESC LIMIT 1
  `)
    .get(attemptId);
  if (!evidence?.session_id) return false;
  if (
    store.db
      .prepare(
        "SELECT 1 FROM events WHERE attempt_id=? AND type='provider.failure_finalized'",
      )
      .get(attemptId)
  )
    return true;
  const session = store.getSession(String(evidence.session_id));
  const attempt = store.getAttempt(attemptId);
  const task = store.getTask(attempt.taskId);
  if (session.attemptId !== attemptId)
    throw new DomainError(
      "INVALID_REFERENCE",
      "Provider failure evidence belongs to another attempt",
    );
  const classified = providerFailureKindSchema.safeParse(
    z
      .object({ providerFailureKind: z.unknown().optional() })
      .parse(JSON.parse(String(evidence.payload))).providerFailureKind,
  );
  if (!classified.success) return false;
  const kind = classified.data;
  const row = store.db
    .prepare(`
    SELECT payload FROM events WHERE attempt_id=? AND type IN
      ('pi.usage','codex.usage','claude-code.usage','opencode.usage','fake.usage') ORDER BY sequence DESC LIMIT 1
  `)
    .get(attemptId);
  const usage = z
    .object({
      inputTokens: z.int().nonnegative().optional(),
      outputTokens: z.int().nonnegative().optional(),
    })
    .safeParse(row ? JSON.parse(String(row.payload)) : {});
  const failure = providerFailureSchema.parse({
    kind,
    evidenceEventId: String(evidence.id),
    inputTokens: usage.success ? (usage.data.inputTokens ?? null) : null,
    outputTokens: usage.success ? (usage.data.outputTokens ?? null) : null,
  });
  const key = `provider-failure:${attemptId}`;
  mutate(
    store.db,
    key,
    "finishProviderFailure",
    { attemptId, safelyEnded, failure },
    humanRequestSchema,
    () => {
      const blocking =
        safelyEnded &&
        session.state === "exited" &&
        session.recovery === "none" &&
        attempt.status === "running" &&
        task.status === "RUNNING" &&
        store.getRun(task.runId).status === "active";
      if (blocking)
        store.updateAttempt(
          { id: attemptId, status: "failed" },
          `${key}:attempt`,
        );
      else if (attempt.status === "running")
        engine.fail(
          task.id,
          attemptId,
          "Provider failure recorded, but shutdown or checkout safety is uncertain; inspect recovery evidence",
          "recovery_required",
        );
      const pendingLeadTurns =
        task.kind === "lead"
          ? store
              .listTasks(task.runId)
              .filter(
                (queued) =>
                  queued.kind === "lead" &&
                  ["READY", "QUEUED"].includes(queued.status),
              )
          : [];
      // A wake-up queued before the failure must not reopen the same native
      // thread. Keep its intent, but require a new owner decision after failure.
      if (!blocking)
        for (const queued of pendingLeadTurns)
          store.transitionTask(
            {
              id: queued.id,
              expectedStatus: queued.status,
              status: "WAITING_HUMAN",
              reason:
                "Lead provider failure requires an explicit owner decision",
            },
            `${key}:hold:${queued.id}`,
          );
      const nextStep = {
        auth: `Use ${session.adapter}'s native authentication/setup flow for the app-owned configuration, then verify access. Keep credentials out of inbox replies.`,
        rate_limit:
          "Check the provider's rate-limit status and adjust usage or wait according to its guidance. No reset time is known to the app.",
        credits_exhausted:
          "Check credits and billing with the provider and restore access there if appropriate. The app cannot read or change your balance.",
        usage_limit:
          "Check the provider's plan, usage limits and billing. This native limit does not establish an exhausted credit balance or a reset time.",
      }[kind];
      const request = store.createHumanRequest(
        {
          runId: task.runId,
          sessionId: session.id,
          affectedTaskIds: [
            task.id,
            ...pendingLeadTurns.map((queued) => queued.id),
          ],
          type: kind === "auth" ? "credential_setup" : "environment",
          urgency: "high",
          blocking,
          reason: `${session.adapter}: ${providerFailureLabels[kind]}. Confirmed by a native error event.${blocking ? "" : " Execution safety is unconfirmed or the task is no longer running; retained recovery/cancellation state takes precedence."}`,
          suggestedAction: `${nextStep} Inspect the retained attempt and worktree, resolve this request, then explicitly choose how to continue. A reply never resumes or retries work.`,
        },
        `${key}:request`,
      );
      const saved = humanRequestSchema.parse({
        ...request,
        providerFailure: failure,
      });
      store.db
        .prepare("UPDATE human_requests SET data=? WHERE id=?")
        .run(JSON.stringify(saved), saved.id);
      store.recordEvent(
        {
          runId: task.runId,
          taskId: task.id,
          attemptId,
          sessionId: session.id,
          type: "provider.failure_finalized",
          correlationId: key,
          causationId: String(evidence.id),
          payload: { requestId: saved.id, blocking, ...failure },
        },
        `${key}:event`,
      );
      notifyLead(
        engine,
        task.id,
        "human_request",
        providerFailureLabels[kind],
        `${key}:notify`,
      );
      return saved;
    },
  );
  return true;
}

export function recoverProviderFailures(engine: Engine) {
  const rows = engine.store.db
    .prepare(`
    SELECT DISTINCT attempt_id FROM events e WHERE type IN (${errorTypes})
      AND json_extract(payload,'$.providerFailureKind') IN (${kinds})
      AND NOT EXISTS (SELECT 1 FROM events f WHERE f.attempt_id=e.attempt_id
        AND f.type='provider.failure_finalized')
  `)
    .all();
  for (const row of rows) {
    const attemptId = String(row.attempt_id);
    const attempt = engine.store.getAttempt(attemptId);
    // A transient error followed by authoritative success is not a blocker.
    if (!["created", "running", "completed"].includes(attempt.status))
      finishProviderFailure(engine, attemptId, false);
  }
}
