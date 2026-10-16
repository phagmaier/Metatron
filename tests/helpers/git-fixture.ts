import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createGitFixture() {
  const root = await mkdtemp(join(tmpdir(), "lao-git-fixture-"));
  const directory = join(root, "repo with spaces");
  const marker = join(root, ".fixture-owner");
  const ownership = randomUUID();
  // Ignore inherited repository/config variables; fixture Git never targets a user repo.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  });
  const git = async (...args: string[]) => {
    const result = await execFileAsync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", ...args],
      { cwd: directory, env, timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    return result.stdout.trim();
  };
  try {
    await writeFile(marker, ownership, { flag: "wx" });
    await mkdir(directory);
    await git("init", "--initial-branch=main");
    await writeFile(join(directory, "README.md"), "# Disposable fixture\n");
    await git("add", "--", "README.md");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "Fixture baseline",
    );
  } catch (error) {
    console.error(`Fixture setup failed; retained at ${root}`);
    throw error;
  }
  return {
    directory,
    git,
    async verify(check: () => Promise<void>) {
      try {
        await check();
        // Only this closure's freshly allocated, marked directory may be removed.
        if (
          (await realpath(root)) !== root ||
          (await readFile(marker, "utf8")) !== ownership
        ) {
          throw new Error("Fixture ownership changed; refusing cleanup");
        }
        await rm(root, { recursive: true });
      } catch (error) {
        console.error(`Fixture verification failed; retained at ${root}`);
        throw error;
      }
    },
  };
}
