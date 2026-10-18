import { useState } from "react";
import type { AgentProfile } from "../shared/domain/entities.ts";
import { writeApi } from "./api.ts";

// Saves a reusable workflow bound to the owner's own read-only profiles. The
// server validates every profile; saving dispatches no work.
export function WorkflowTemplateForm({
  profiles,
  demoProfileIds,
  busy,
  act,
  saved,
}: {
  profiles: AgentProfile[];
  demoProfileIds: string[];
  busy: boolean;
  act: (action: () => Promise<void>) => void;
  saved: (name: string) => Promise<void>;
}) {
  const readers = profiles.filter(
    (p) => p.permission === "read_only" && !demoProfileIds.includes(p.id),
  );
  const [kind, setKind] = useState<"explore" | "review">("explore");
  const [readerId, setReaderId] = useState("");
  const [synthesizerId, setSynthesizerId] = useState("");
  const [readerCount, setReaderCount] = useState(4);
  const select = (
    label: string,
    value: string,
    onChange: (value: string) => void,
  ) => (
    <label>
      {label}
      <select
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose a read-only profile</option>
        {readers.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} · {profile.harness} {profile.model}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <details>
      <summary>Save a workflow template</summary>
      <p className="note">
        Workflows run only your saved read-only profiles. Add the saved template
        to a team under Available workflows.
      </p>
      {readers.length === 0 ? (
        <p className="note">Save a native read-only profile first.</p>
      ) : (
        <div className="form-row">
          <label>
            Workflow
            <select
              value={kind}
              disabled={busy}
              onChange={(event) =>
                setKind(event.target.value === "review" ? "review" : "explore")
              }
            >
              <option value="explore">Explore Subsystem</option>
              <option value="review">Review Implementation</option>
            </select>
          </label>
          {kind === "explore" ? (
            <>
              {select("Readers", readerId, setReaderId)}
              <label>
                Reader count
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={readerCount}
                  disabled={busy}
                  onChange={(event) =>
                    setReaderCount(Number(event.target.value))
                  }
                />
              </label>
              {select("Synthesizer", synthesizerId, setSynthesizerId)}
            </>
          ) : (
            select("Reviewer", readerId, setReaderId)
          )}
          <button
            type="button"
            disabled={
              busy || !readerId || (kind === "explore" && !synthesizerId)
            }
            onClick={() =>
              act(async () => {
                await writeApi(
                  `workflow-templates/${kind}`,
                  kind === "explore"
                    ? {
                        readerProfileId: readerId,
                        synthesizerProfileId: synthesizerId,
                        readerCount,
                      }
                    : { reviewerProfileId: readerId },
                );
                await saved(
                  kind === "explore"
                    ? "Explore Subsystem"
                    : "Review Implementation",
                );
              })
            }
          >
            Save workflow template
          </button>
        </div>
      )}
    </details>
  );
}
