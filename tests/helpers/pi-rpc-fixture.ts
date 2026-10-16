import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// Deterministic subprocess protocol fixture. It never starts a native harness
// or contacts a provider, and only writes inside its disposable test cwd.
let buffer = "";
let model = "fixture/model";
let thinking = "off";
const emit = (value: unknown) =>
  process.stdout.write(`${JSON.stringify(value)}\n`);
process.stdin.on("data", (chunk) => {
  buffer += String(chunk);
  while (buffer.includes("\n")) {
    const end = buffer.indexOf("\n");
    const command = z
      .object({
        id: z.string(),
        type: z.string(),
        provider: z.string().optional(),
        modelId: z.string().optional(),
        level: z.string().optional(),
      })
      .parse(JSON.parse(buffer.slice(0, end)));
    buffer = buffer.slice(end + 1);
    let data: unknown = {};
    switch (command.type) {
      case "get_available_models":
        data = {
          models: [
            { id: "model", name: "Protocol fixture", provider: "fixture" },
          ],
        };
        break;
      case "set_model":
        model = `${command.provider}/${command.modelId}`;
        break;
      case "get_available_thinking_levels":
        data = { levels: ["off", "low"] };
        break;
      case "set_thinking_level":
        thinking = command.level ?? "off";
        break;
      case "get_state":
        data = {
          sessionId: `fixture-${process.pid}`,
          model: { provider: model.split("/")[0], id: model.split("/")[1] },
          thinkingLevel: thinking,
        };
        break;
      case "get_commands":
        data = {
          commands: process.env.LAO_FIXTURE_NO_GUARD
            ? []
            : [{ name: "lao_guard" }],
        };
        break;
      case "prompt":
        data = { disposition: "started" };
        break;
    }
    emit({
      id: command.id,
      type: "response",
      command: command.type,
      success: true,
      data,
    });
    if (command.type === "abort") {
      emit({ type: "agent_settled", aborted: true });
      continue;
    }
    if (command.type !== "prompt") continue;
    const scenario = process.env.LAO_FIXTURE_SCENARIO;
    if (scenario === "hold") continue;
    if (scenario === "exit") {
      process.exit(0);
    }
    if (scenario === "auth") {
      emit({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "401 credential fixture-secret",
        },
      });
      emit({ type: "agent_settled", aborted: false });
      continue;
    }
    void (async () => {
      if (process.env.LAO_PI_PERMISSION === "workspace_write")
        await writeFile(
          join(process.cwd(), "fixture-result.txt"),
          "Protocol fixture result\n",
        );
      emit({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "Protocol fixture report",
        },
      });
      emit({
        type: "message_end",
        message: { role: "assistant", stopReason: "stop" },
      });
      emit({ type: "agent_end", messages: [], willRetry: false });
      emit({ type: "agent_settled", aborted: false });
    })();
  }
});
