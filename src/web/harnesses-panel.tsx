import { useState } from "react";
import type { z } from "zod";
import { harnessSchema } from "../shared/domain/entities.ts";
import {
  type HarnessState,
  type ProfileCapabilities,
  profileCapabilitiesSchema,
} from "../shared/profiles.ts";
import { readApi } from "./api.ts";

type Harness = z.infer<typeof harnessSchema>;

const harnessLabel: Record<Harness, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  pi: "Pi",
};
export const stateLabel: Record<HarnessState, string> = {
  missing: "Missing",
  installed: "Installed · not ready",
  auth_required: "Login required",
  available: "Available",
  unknown: "Discovery failed",
};
const authLabel = (value: ProfileCapabilities["authenticated"]) =>
  value === true
    ? "logged in"
    : value === false
      ? "no usable login"
      : "login unverified";

export function NextStep({ text }: { text: string | null }) {
  return text ? (
    <p className="next-step">
      <strong>Next step:</strong> {text}
    </p>
  ) : null;
}

type Row = { harness: Harness } & (
  | { result: ProfileCapabilities }
  | { error: string }
);

function HarnessCard({ row }: { row: Row }) {
  const label = harnessLabel[row.harness];
  if ("error" in row)
    return (
      <li className="harness">
        <div className="section-title">
          <h3>{label}</h3>
          <span className="badge state-unknown">Check failed</span>
        </div>
        <NextStep
          text={`The check request failed (${row.error}); check again.`}
        />
      </li>
    );
  const { result } = row;
  return (
    <li className="harness">
      <div className="section-title">
        <h3>{label}</h3>
        <span className={`badge state-${result.state}`}>
          {stateLabel[result.state]}
        </span>
      </div>
      {result.state !== "missing" && result.state !== "unknown" && (
        <p className="note">
          {result.version
            ? `Version ${result.version}`
            : "Version not reported"}{" "}
          · {authLabel(result.authenticated)} · {result.models.length} model(s)
          listed
        </p>
      )}
      {result.state === "available" && result.authenticated === "unknown" && (
        <p className="note">
          Provider access is unverified until a native turn succeeds.
        </p>
      )}
      <NextStep text={result.nextStep} />
      <details>
        <summary>Diagnostics ({result.diagnostics.length})</summary>
        <ul className="diagnostics">
          {result.diagnostics.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </li>
  );
}

export function HarnessesPanel() {
  const [rows, setRows] = useState<Row[]>();
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date>();
  async function check() {
    setBusy(true);
    try {
      setRows(
        await Promise.all(
          harnessSchema.options.map(async (harness): Promise<Row> => {
            try {
              return {
                harness,
                result: profileCapabilitiesSchema.parse(
                  await readApi(`agent-profiles/discover?harness=${harness}`),
                ),
              };
            } catch (error) {
              return {
                harness,
                error:
                  error instanceof Error ? error.message : "request failed",
              };
            }
          }),
        ),
      );
      setCheckedAt(new Date());
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="harnesses-title">
      <div className="section-title">
        <h2 id="harnesses-title">Harness setup</h2>
        <button type="button" disabled={busy} onClick={() => void check()}>
          {busy ? "Checking…" : rows ? "Check again" : "Check harnesses"}
        </button>
      </div>
      <p className="note">
        Starts each installed harness with this app's own configuration and
        reads its version, login and model catalog. No model prompt is sent, and
        a listed model is not proof of provider access.
      </p>
      {rows ? (
        <ul className="harnesses" aria-busy={busy}>
          {rows.map((row) => (
            <HarnessCard key={row.harness} row={row} />
          ))}
        </ul>
      ) : (
        <p className="note">{busy ? "Checking…" : "Not checked yet."}</p>
      )}
      {checkedAt && (
        <p className="note">
          Checked{" "}
          <time dateTime={checkedAt.toISOString()}>
            {checkedAt.toLocaleTimeString()}
          </time>
        </p>
      )}
    </section>
  );
}
