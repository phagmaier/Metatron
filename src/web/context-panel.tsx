import {
  type ContextPolicy,
  contextPolicySchema,
  type Session,
} from "../shared/domain/entities.ts";

export type ContextChoiceValue = {
  contextPolicy: ContextPolicy;
  resumeSessionId: string | null;
};

const short = (id: string) => id.slice(0, 8);

// Resume can name only the task's latest session; the server decides whether
// the adapter and checkout allow it and refuses otherwise.
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
        <option value="resume" disabled={!latest}>
          Resume {latest ? `session ${short(latest.id)}` : "(no session)"}
        </option>
      </select>
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
