import { appendFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { findingsReview, passReview } from "./review-result.ts";

// Deterministic subprocess protocol fixture. It never starts a native harness
// or contacts a provider, and only writes inside its disposable test cwd.
// Stands in for Pi's built-in MCP client when the app gateway is configured.
async function gateway(name: string, args: object) {
  const url = process.env.LAO_GATEWAY_URL;
  if (!url) return;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LAO_GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return z
    .object({
      result: z.object({
        isError: z.boolean(),
        structuredContent: z.object({ result: z.unknown().optional() }),
      }),
    })
    .parse(await response.json()).result;
}
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
        message: z.string().optional(),
      })
      .parse(JSON.parse(buffer.slice(0, end)));
    buffer = buffer.slice(end + 1);
    if (
      ["clear_queue", "abort"].includes(command.type) &&
      process.env.LAO_FIXTURE_CONTROL_LOG
    )
      appendFileSync(process.env.LAO_FIXTURE_CONTROL_LOG, `${command.type}\n`);
    if (
      command.type === "clear_queue" &&
      process.env.LAO_FIXTURE_SCENARIO === "message-clear-fail"
    ) {
      emit({
        id: command.id,
        type: "response",
        command: command.type,
        success: false,
        error: "fixture queue refusal",
      });
      continue;
    }
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
            : [
                { name: "lao_guard" },
                ...(process.env.LAO_GATEWAY_URL
                  ? [{ name: "lao_gateway" }]
                  : []),
              ],
        };
        break;
      case "prompt":
        if (process.env.LAO_FIXTURE_PROMPT_LOG)
          appendFileSync(
            process.env.LAO_FIXTURE_PROMPT_LOG,
            `${JSON.stringify(command.message)}\n`,
          );
        data = { disposition: "started" };
        break;
      case "steer":
      case "follow_up":
        if (process.env.LAO_FIXTURE_MESSAGE_LOG)
          appendFileSync(
            process.env.LAO_FIXTURE_MESSAGE_LOG,
            `${JSON.stringify(command)}\n`,
          );
        if (process.env.LAO_FIXTURE_SCENARIO === "message-lost") {
          process.exit(0);
        }
        data = { disposition: "queued" };
        if (process.env.LAO_FIXTURE_SCENARIO === "message-early") {
          emit({
            type: "message_start",
            message: { role: "user", content: command.message },
          });
          setTimeout(
            () =>
              emit({
                id: command.id,
                type: "response",
                command: command.type,
                success: true,
                data,
              }),
            30,
          );
          continue;
        }
        break;
    }
    emit({
      id: command.id,
      type: "response",
      command: command.type,
      success: true,
      data,
    });
    if (["steer", "follow_up"].includes(command.type)) {
      if (process.env.LAO_FIXTURE_SCENARIO === "message-deliver") {
        // Unrelated user/assistant messages cannot acknowledge this operation.
        emit({
          type: "message_start",
          message: { role: "user", content: "unrelated" },
        });
        emit({
          type: "message_start",
          message: { role: "assistant", content: command.message },
        });
        setTimeout(
          () =>
            emit({
              type: "message_start",
              message: {
                role: "user",
                content: [{ type: "text", text: command.message }],
              },
            }),
          Number(process.env.LAO_FIXTURE_MESSAGE_DELAY ?? 100),
        );
      }
      continue;
    }
    if (command.type === "abort") {
      emit({ type: "agent_settled", aborted: true });
      continue;
    }
    if (command.type !== "prompt") continue;
    const scenario = process.env.LAO_FIXTURE_SCENARIO;
    if (scenario?.startsWith("message-")) {
      emit({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "Protocol fixture awaiting owner input",
        },
      });
      continue;
    }
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
    // "tracked" edits an existing file instead of creating a new one, and its
    // read-only sessions report the README they see. In "tamper" a read-only
    // session also writes, as a policy bypass would.
    const tracked =
      scenario === "tracked" ||
      scenario === "tamper" ||
      scenario?.startsWith("review-");
    const written = tracked ? "README.md" : "fixture-result.txt";
    const writer = process.env.LAO_PI_PERMISSION === "workspace_write";
    void (async () => {
      const assignment = await gateway("read_assignment", {});
      if (scenario?.startsWith("help-") || scenario?.startsWith("issue-")) {
        if (writer)
          await writeFile(
            join(process.cwd(), "help-scratch.txt"),
            "Unfinished fixture work; preserve me\n",
          );
        const result = scenario.startsWith("help-")
          ? await gateway("request_human_action", {
              type: "environment",
              reason: "Fixture dependency needs owner setup",
              suggestedAction:
                "Inspect the retained fixture and record a decision",
              blocking: scenario !== "help-nonblocking",
            })
          : await gateway("report_issue", {
              summary: "Fixture finding",
              details: "Inspect fixture evidence",
              urgency: scenario === "issue-urgent" ? "urgent" : "normal",
              blocking: scenario === "issue-blocking",
            });
        if (result?.isError)
          throw new Error("Fixture worker signal was rejected");
        if (scenario !== "help-nonblocking" && scenario !== "issue-info")
          return;
      }
      const revising =
        assignment &&
        z
          .object({ revision: z.unknown().optional() })
          .parse(assignment.structuredContent.result).revision;
      const review =
        assignment &&
        z
          .object({ review: z.unknown() })
          .parse(assignment.structuredContent.result).review;
      if (scenario === "urgent")
        await gateway("report_issue", {
          summary: "Fixture urgent issue",
          details: "Deterministic urgent issue",
          urgency: "urgent",
        });
      if (scenario !== "review-missing") {
        const result = await gateway(
          "submit_result",
          review
            ? scenario === "review-invalid"
              ? {
                  ...findingsReview,
                  findings: [{ ...findingsReview.findings[0], line: 0 }],
                }
              : scenario === "review-findings"
                ? findingsReview
                : passReview
            : {
                outcome: "completed",
                summary: "Protocol fixture structured summary",
                changedFiles: writer ? [written] : [],
                tests: [{ command: "not run", result: "not_run" }],
              },
        );
        if (result?.isError && scenario !== "review-invalid")
          throw new Error("Fixture result was unexpectedly rejected");
      }
      if (scenario === "review-exit") process.exit(0);
      if (scenario === "review-hold") return;
      if (writer || scenario === "tamper" || scenario === "review-tamper")
        await writeFile(
          join(process.cwd(), written),
          writer
            ? revising
              ? `# Revised heading\n\n${await readFile(join(process.cwd(), written), "utf8")}`
              : "Protocol fixture result\n"
            : "Tampered by a reader\n",
        );
      emit({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta:
            tracked && !writer
              ? `Reviewed README: ${await readFile(join(process.cwd(), "README.md"), "utf8")}`
              : "Protocol fixture report",
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
