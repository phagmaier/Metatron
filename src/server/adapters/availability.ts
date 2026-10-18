import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { DomainError } from "../../shared/domain/states.ts";

// Only absolute PATH entries are searched. Harnesses run inside worktrees, so
// a relative entry would resolve against repository-controlled content.
export async function findExecutable(
  name: string,
  label: string,
  explicit?: string,
): Promise<string> {
  const candidates = explicit
    ? isAbsolute(explicit)
      ? [explicit]
      : []
    : (process.env.PATH ?? "")
        .split(delimiter)
        .filter(isAbsolute)
        .map((entry) => join(entry, name));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Continue only through absolute candidates. */
    }
  }
  throw new DomainError(
    // Discovery reports exactly this code as "missing"; every later failure
    // means the executable was found.
    "NOT_INSTALLED",
    `${label} executable \`${name}\` was not found on the app server's absolute PATH. Install ${label}, make sure \`${name}\` resolves in the shell that starts this app, restart the app and check again.`,
  );
}

export function notInstalled(error: unknown): error is DomainError {
  return error instanceof DomainError && error.code === "NOT_INSTALLED";
}

export function unreadyStep(label: string) {
  return `${label} was found but did not finish no-model discovery. Check its discovery diagnostics, confirm the installed version matches the one recorded in docs/adapter-recon.md, then check again.`;
}
