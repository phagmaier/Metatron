import { z } from "zod";
import { idSchema, textSchema } from "./domain/entities.ts";

export const sendWorkerMessageSchema = z.strictObject({
  taskId: idSchema,
  sessionId: idSchema,
  kind: z.enum(["steer", "follow_up"]),
  text: textSchema.max(4000),
});
