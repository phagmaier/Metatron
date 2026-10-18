import {
  type ContextPolicy,
  contextPolicySchema,
  type Session,
} from "../shared/domain/entities.ts";
import { resumeUnsupported } from "../shared/native-controls.ts";

export type ContextChoiceValue = {
  contextPolicy: ContextPolicy;
  resumeSessionId: string | null;
};

const short = (id: string) => id.slice(0, 8);

// Resume can name only the task's latest session; the server decides whether
// the profile and checkout allow it and refuses otherwise. A harness that can
// never resume an assignment is not offered.
export function ContextChoice({
  value,
  sessions,
  onChange,
}: {
  value: ContextChoiceValue;
  sessions: Session[];
  onChange: (value: ContextChoiceValue) => void;
}) {
  const latest = sessions.at(-1);
  const blocked = latest ? resumeUnsupported[latest.adapter] : null;
  return (
    <label>
      Context
      <select
        value={value.contextPolicy}
        onChange={(event) => {
          const policy = contextPolicySchema.parse(event.target.value);
          onChange({
            contextPolicy: policy,
            resumeSessionId: policy === "resume" ? (latest?.id ?? null) : null,
          });
        }}
      >
        <option value="auto">Auto</option>
        <option value="fresh">Fresh + checkpoint</option>
        <option value="resume" disabled={!latest || blocked !== null}>
          Resume {latest ? `session ${short(latest.id)}` : "(no session)"}
          {blocked && " · unsupported"}
        </option>
      </select>
      {blocked && <small className="note">Resume unsupported: {blocked}</small>}
    </label>
  );
}

export function SessionContext({ session }: { session: Session }) {
  const { context } = session;
  return (
    <span className="note">
      Context {session.contextPolicy}
      {context
        ? ` → ${context.effective}: ${context.reason}`
        : " (recorded before context policies)"}
      {context?.predecessorSessionId && (
        <>
          <br />
          Continues from session {short(context.predecessorSessionId)} · attempt{" "}
          {short(context.predecessorAttemptId ?? "")}
          {context.checkpointArtifactId &&
            ` · checkpoint ${short(context.checkpointArtifactId)} in View report`}
        </>
      )}
      <br />
      Transcript:{" "}
      <span className="path">
        {session.transcriptPath ?? "not recorded by this adapter"}
      </span>
    </span>
  );
}
