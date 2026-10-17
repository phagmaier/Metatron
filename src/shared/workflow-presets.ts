import { z } from "zod";
import { idSchema } from "./domain/entities.ts";
import type { workflowContentSchema } from "./domain/workflow.ts";

export const exploreSubsystemConfigSchema = z.strictObject({
  readerProfileId: idSchema,
  synthesizerProfileId: idSchema,
  readerCount: z.int().min(1).max(4).default(4),
});

const explorationAreas = [
  "Entry points and architecture: locate the subsystem's public interfaces, callers, main modules and boundaries. Cite concrete file:line locations and trace a representative entry path.",
  "State and data flow: trace inputs, transformations, persisted state and outputs. Identify state transitions, invariants, error paths and concurrency boundaries with file:line evidence.",
  "Dependencies: identify internal and external dependencies, configuration and integration contracts. Explain coupling, ownership and side effects with file:line evidence; distinguish verified dependencies from inferred ones.",
  "Tests and edge cases: locate relevant tests and fixtures, identify the behavior they cover, and call out untested boundaries and failure cases with file:line evidence. Do not claim tests ran; this exploration does not execute them.",
];

export function exploreSubsystemContent(
  config: z.infer<typeof exploreSubsystemConfigSchema>,
): z.input<typeof workflowContentSchema> {
  // Smaller teams group every area exactly once instead of dropping coverage
  // or sending identical prompts. The saved graph, not a model, fixes the split.
  const partitions = Array.from({ length: config.readerCount }, (_, reader) =>
    explorationAreas
      .filter((_, area) => area % config.readerCount === reader)
      .join("\n\n"),
  );
  return {
    name: "Explore Subsystem",
    inputs: [
      {
        name: "target",
        description: "Repository subsystem, path or question to investigate",
      },
    ],
    results: [{ name: "exploration", stageId: "synthesis" }],
    stages: [
      {
        id: "readers",
        type: "parallel_agents",
        profileId: config.readerProfileId,
        instructions:
          "Explore the declared target without changing source files. Investigate your independent partition; read surrounding code only to establish the target's boundaries and contracts. Return observed facts separately from inferences. Put the most important findings and file:line citations first in a concise handoff, with explicit gaps and uncertainty. Do not delegate or expand into unrelated work.",
        inputs: [{ name: "target", source: "parameter", ref: "target" }],
        result:
          "Concise partition findings with file:line evidence, relevant relationships or invariants, confidence and unanswered questions. Preserve detailed evidence in the reader report; do not invent unobserved behavior or test results.",
        dependsOn: [],
        count: config.readerCount,
        partitions,
        partialFailure: "stop",
      },
      {
        id: "synthesis",
        type: "synthesize",
        profileId: config.synthesizerProfileId,
        instructions:
          "Consolidate the available reader reports into one concise subsystem exploration for the Lead. Respect the declared target, reconcile overlapping findings and surface disagreements rather than silently choosing a claim. Retain source file:line citations and the supplied reader task/artifact references. Identify failed or unavailable readers and label the result partial when evidence is incomplete; never invent their findings. Separate supported conclusions, inferences and open questions. Do not modify source or claim unperformed tests.",
        inputs: [
          { name: "target", source: "parameter", ref: "target" },
          { name: "reader_reports", source: "stage", ref: "readers" },
        ],
        result:
          "Concise subsystem map: scope and entry points; state/data flow and invariants; dependencies; tests and edge cases; cited reader/file evidence; disagreements, failed-reader coverage and remaining unknowns. State complete versus partial evidence explicitly.",
        dependsOn: ["readers"],
        count: 1,
        partitions: [],
        partialFailure: "include_partial",
      },
    ],
  };
}

export const reviewImplementationConfigSchema = z.strictObject({
  reviewerProfileId: idSchema,
});

export function reviewImplementationContent(
  config: z.infer<typeof reviewImplementationConfigSchema>,
): z.input<typeof workflowContentSchema> {
  return {
    name: "Review Implementation",
    inputs: [
      {
        name: "candidate_id",
        description:
          "Captured integration candidate ID from an implementation awaiting review in this run",
      },
    ],
    results: [{ name: "review", stageId: "review" }],
    stages: [
      {
        id: "review",
        type: "review",
        profileId: config.reviewerProfileId,
        instructions:
          "Independently review the stable candidate diff and the surrounding repository snapshot against the original objective and acceptance criteria. Trace changed behavior into callers, dependencies and tests; prioritize actionable correctness, safety and regression findings with file:line evidence and confidence. Separate observed facts from inference and state coverage gaps. Do not rely on the implementer's report, edit files, delegate, expand scope or approve integration. Shell is disabled; never claim unperformed tests.",
        inputs: [
          { name: "candidate_id", source: "parameter", ref: "candidate_id" },
        ],
        result:
          "Submit a structured review: summary, pass or changes_requested recommendation, actionable findings with severity, repository-relative file, positive line, justification, evidence and confidence, and tests honestly marked not_run. A recommendation is not human approval or integration authority.",
        dependsOn: [],
        count: 1,
        partitions: [],
        partialFailure: "stop",
      },
    ],
  };
}
