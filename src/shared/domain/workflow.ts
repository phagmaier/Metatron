import { z } from "zod";

const keySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const guidance = z.string().trim().min(1).max(4000);
const names = z
  .array(keySchema)
  .max(128)
  .refine(
    (items) => new Set(items).size === items.length,
    "Duplicate references",
  );
const bindingSchema = z.strictObject({
  name: keySchema,
  source: z.enum(["parameter", "stage"]),
  ref: keySchema,
});
export const workflowFields = {
  name: z.string().trim().min(1).max(160),
  inputs: z
    .array(z.strictObject({ name: keySchema, description: guidance }))
    .max(32),
  results: z
    .array(z.strictObject({ name: keySchema, stageId: keySchema }))
    .min(1)
    .max(32),
  stages: z
    .array(
      z.strictObject({
        id: keySchema,
        type: z.enum(["single_agent", "parallel_agents", "synthesize"]),
        profileId: z.uuid(),
        instructions: guidance,
        inputs: z.array(bindingSchema).max(32),
        result: guidance,
        dependsOn: names,
        count: z.int().min(1).max(64),
        partitions: z.array(guidance).max(64),
        partialFailure: z.enum(["stop", "include_partial"]),
      }),
    )
    .min(1)
    .max(128),
};
const definition = z.strictObject(workflowFields);
export function validateWorkflow(
  value: z.infer<typeof definition>,
  ctx: z.RefinementCtx,
) {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const parameters = new Set(value.inputs.map((input) => input.name));
  if (parameters.size !== value.inputs.length)
    issue("Duplicate workflow inputs");
  if (
    new Set(value.results.map((result) => result.name)).size !==
    value.results.length
  )
    issue("Duplicate workflow results");
  if (value.stages.reduce((total, stage) => total + stage.count, 0) > 128)
    issue("A workflow may contain at most 128 child tasks");
  const prior = new Map<string, (typeof value.stages)[number]>();
  for (const stage of value.stages) {
    if (prior.has(stage.id)) issue("Duplicate stage IDs");
    if (stage.dependsOn.some((id) => !prior.has(id)))
      issue(
        "Dependencies must name earlier stages; cycles and forward references are forbidden",
      );
    if (
      new Set(stage.inputs.map((input) => input.name)).size !==
      stage.inputs.length
    )
      issue("Duplicate stage inputs");
    for (const input of stage.inputs) {
      if (
        input.source === "parameter"
          ? !parameters.has(input.ref)
          : !stage.dependsOn.includes(input.ref)
      )
        issue(
          "Stage inputs must reference declared parameters or direct dependencies",
        );
    }
    if (stage.type === "parallel_agents") {
      if (stage.partitions.length !== stage.count)
        issue("Each parallel child needs an explicit partition");
    } else if (stage.count !== 1 || stage.partitions.length)
      issue(
        "Single-agent and synthesis stages have one child and no partitions",
      );
    if (
      stage.type === "synthesize" &&
      !stage.inputs.some((input) => input.source === "stage")
    )
      issue("Synthesis requires an upstream stage result");
    prior.set(stage.id, stage);
  }
  if (value.results.some((result) => !prior.has(result.stageId)))
    issue("Unknown workflow result stage");
}
export const workflowContentSchema = definition.superRefine(validateWorkflow);
