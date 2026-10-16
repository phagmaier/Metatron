import { useState } from "react";
import type { Task } from "../shared/domain/entities.ts";
import {
  type ApplyPlan,
  applyPlanSchema,
  type IntegrationPreview,
  integrationPreviewSchema,
} from "../shared/integration.ts";
import { readApi, writeApi } from "./api.ts";

const short = (sha: string | null) => sha?.slice(0, 12) ?? "none";
// Display only: commands run as argument arrays, never through a shell.
const quote = (arg: string) =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
const methods: Record<ApplyPlan["method"], string> = {
  update_ref: "branch moved (not checked out)",
  fast_forward_checkout: "fast-forwarded in your checkout",
  record_existing: "recorded; branch already at the result",
};

function describe(plan: ApplyPlan) {
  const branch = plan.destinationBranch;
  if (plan.method === "record_existing")
    return `${branch} already points at the approved result. Confirming records it as integrated; no Git command runs.`;
  if (plan.method === "fast_forward_checkout")
    return `${branch} is checked out in ${plan.checkoutPath}. It is fast-forwarded there, which updates the files in that checkout. Local and ignored files are never overwritten; Git refuses instead.`;
  return `${branch} is not checked out, so only the branch moves, and only if it is still at the approved commit. Your checkout and its files are not touched.`;
}

// The owner reviews a freshly computed plan and confirms exactly that plan; the
// server recomputes it and refuses if anything differs.
export function ApplyPanel({
  preview,
  task,
  onApplied,
  onError,
}: {
  preview: IntegrationPreview;
  task: Task;
  onApplied: (preview: IntegrationPreview) => void;
  onError: (error: string) => void;
}) {
  const [plan, setPlan] = useState<ApplyPlan>();
  const [busy, setBusy] = useState(false);
  const branch = preview.destinationBranch;
  const open = ["READY_TO_INTEGRATE", "BLOCKED_CONFLICT"].includes(task.status);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    onError("");
    try {
      await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  const check = () =>
    act(async () =>
      setPlan(
        applyPlanSchema.parse(
          await readApi(`integrations/plan?integrationId=${preview.id}`),
        ),
      ),
    );
  const confirm = (shown: ApplyPlan) =>
    act(async () => {
      onApplied(
        integrationPreviewSchema.parse(
          await writeApi("integrations/apply", {
            integrationId: shown.integrationId,
            confirm: {
              method: shown.method,
              expectedSha: shown.expectedSha,
              resultSha: shown.resultSha,
              checkoutPath: shown.checkoutPath,
            },
          }),
        ),
      );
      setPlan(undefined);
    });
  return (
    <div>
      <p>
        <strong>Apply to {branch}</strong>
      </p>
      {preview.applications.length > 0 && (
        <ul className="reviews">
          {preview.applications.map((application) => (
            <li
              key={application.id}
              className={application.status === "applied" ? "note" : "warning"}
            >
              {application.status} · {methods[application.method]} · {branch} at{" "}
              {short(application.observedSha)} ·{" "}
              <time dateTime={application.startedAt}>
                {new Date(application.startedAt).toLocaleString()}
              </time>
              {application.diagnostic ? ` · ${application.diagnostic}` : ""}
            </li>
          ))}
        </ul>
      )}
      {task.status === "INTEGRATING" && <p className="warning">Applying…</p>}
      {task.status === "DONE" && (
        <p className="note">
          Integrated into {branch}. The integration worktree, its branch, diff
          and logs are kept.
        </p>
      )}
      {open && !plan && (
        <button type="button" disabled={busy} onClick={() => void check()}>
          Review apply plan
        </button>
      )}
      {open && plan && (
        <div className={plan.blockers.length ? "warning" : "note"}>
          <p>{describe(plan)}</p>
          <p>
            {branch} now {short(plan.currentSha)} · approved{" "}
            {short(plan.expectedSha)} → {short(plan.resultSha)}
          </p>
          {plan.commands.length > 0 && (
            <>
              <pre className="report">
                {plan.commands
                  .map((c) =>
                    ["git", "-C", c.cwd, ...c.args].map(quote).join(" "),
                  )
                  .join("\n")}
              </pre>
              <p className="note">
                The app also disables hooks and global/system Git config.
              </p>
            </>
          )}
          {plan.blockers.length > 0 && (
            <ul>
              {plan.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          <div className="actions">
            {plan.blockers.length === 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirm(plan)}
              >
                Confirm apply to {branch}
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void check()}>
              Recheck
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
