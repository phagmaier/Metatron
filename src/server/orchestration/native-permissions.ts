import { humanRequestSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { nativePermissionDenialSchema } from "../../shared/native-permissions.ts";
import { mutate } from "../storage/mutations.ts";
import type { Store } from "../storage/store.ts";

export function recordNativePermissionDenial(
  store: Store,
  sessionId: string,
  input: unknown,
) {
  const permission = nativePermissionDenialSchema.parse(input);
  const session = store.getSession(sessionId);
  const attempt = store.getAttempt(session.attemptId);
  const task = store.getTask(attempt.taskId);
  if (
    session.adapter !== permission.adapter ||
    attempt.adapter !== permission.adapter ||
    task.kind !== "lead"
  )
    throw new DomainError(
      "INVALID_REFERENCE",
      "Native permission denial must belong to a Codex Lead session",
    );
  const key = `native-permission:${session.id}:${permission.requestFingerprint}`;
  return mutate(
    store.db,
    key,
    "nativePermissionDenied",
    { sessionId, permission },
    humanRequestSchema,
    () => {
      // Native denial has already been chosen. This is an owner notification,
      // not a pending grant or a fabricated pause of a live native process.
      const request = store.createHumanRequest(
        {
          runId: task.runId,
          sessionId,
          affectedTaskIds: [task.id],
          type: "permission",
          urgency: "high",
          blocking: false,
          reason: `Codex requested ${permission.method}; denied by the read-only Lead policy.`,
          suggestedAction:
            "Review the app-owned native transcript if needed, then acknowledge this denial. Use an assigned worker for implementation; acknowledging cannot grant permissions or resume work.",
        },
        `${key}:request`,
      );
      const updated = humanRequestSchema.parse({
        ...request,
        nativePermission: permission,
      });
      store.db
        .prepare("UPDATE human_requests SET data=? WHERE id=?")
        .run(JSON.stringify(updated), request.id);
      store.recordEvent(
        {
          runId: task.runId,
          taskId: task.id,
          attemptId: attempt.id,
          sessionId,
          type: "native_permission.denied",
          correlationId: key,
          payload: { requestId: request.id, ...permission },
        },
        `${key}:event`,
      );
      return updated;
    },
  );
}
