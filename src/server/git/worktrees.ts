import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DomainError } from "../../shared/domain/states.ts";
import {
  type Worktree,
  worktreeEvidenceSchema,
  worktreeSchema,
} from "../../shared/worktrees.ts";
import type { Store } from "../storage/store.ts";
import { GitError, git } from "./command.ts";
import { inspectRepository, requireClean } from "./inspect.ts";
import { inside, sensitivePath } from "./paths.ts";

export class Worktrees {
  private readonly store: Store;
  private readonly directory: string;
  constructor(store: Store, directory: string) {
    this.store = store;
    this.directory = resolve(directory);
  }
  list(): Worktree[] {
    return this.store.db
      .prepare("SELECT data FROM worktrees ORDER BY rowid")
      .all()
      .map((row) => worktreeSchema.parse(JSON.parse(String(row.data))));
  }
  async prepare(attemptId: string) {
    const attempt = this.store.getAttempt(attemptId);
    const task = this.store.getTask(attempt.taskId);
    const run = this.store.getRun(task.runId);
    if (
      attempt.status !== "running" ||
      run.status !== "active" ||
      run.mode === "chat_plan"
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Only an active reserved native attempt may create a worktree",
      );
    const repository = await inspectRepository(
      this.store.getProject(run.projectId).repositoryPath,
    );
    requireClean(repository);
    if (
      !run.repository ||
      repository.root !== run.repository.root ||
      repository.commonDirectory !== run.repository.commonDirectory ||
      repository.baseSha !== run.repository.baseSha
    )
      throw new DomainError(
        "CONFLICT",
        "Repository identity or base changed before worktree creation",
      );
    if (
      attempt.adapter !== "pi" ||
      !attempt.worktreePath ||
      attempt.cwd !== attempt.worktreePath
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Native attempt requires an isolated worktree",
      );
    const root = join(this.directory, "worktrees");
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (
      (await realpath(this.directory)) !== this.directory ||
      (await realpath(root)) !== root ||
      inside(repository.root, root) ||
      !inside(root, attempt.cwd) ||
      attempt.cwd === root
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Worktree storage must be canonical app-owned data outside the source checkout",
      );
    const previous = this.list().find((w) => w.attemptId === attemptId);
    if (previous) {
      if (previous.state !== "ready")
        throw new DomainError(
          "CONFLICT",
          "Ambiguous worktree creation is retained; never replay automatically",
        );
      await this.verify(previous);
      return previous;
    }
    const manifest = worktreeSchema.parse({
      attemptId,
      path: attempt.cwd,
      branch: `lao/attempt-${attemptId}`,
      ownerToken: randomUUID(),
      repository,
      state: "creating",
    });
    const currentRun = this.store.getRun(run.id);
    if (
      currentRun.status !== "active" ||
      currentRun.mode === "chat_plan" ||
      this.store.getTask(task.id).status !== "RUNNING"
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Run/task policy changed during repository inspection",
      );
    // Intent is durable before Git touches its shared metadata. A crash keeps
    // this claim and the working copy; it never triggers a second worktree add.
    this.store.db
      .prepare("INSERT INTO worktrees(attempt_id,path,data) VALUES (?,?,?)")
      .run(attemptId, manifest.path, JSON.stringify(manifest));
    try {
      await mkdir(dirname(manifest.path), { mode: 0o700 });
      await writeFile(
        join(dirname(manifest.path), "ownership.json"),
        JSON.stringify(manifest),
        { flag: "wx", mode: 0o600 },
      );
      if (
        this.store.getRun(run.id).mode === "chat_plan" ||
        this.store.getRun(run.id).status !== "active" ||
        this.store.getTask(task.id).status !== "RUNNING"
      )
        throw new DomainError(
          "POLICY_DENIED",
          "Run/task policy changed before Git mutation",
        );
      await git(repository.root, [
        "worktree",
        "add",
        "-b",
        manifest.branch,
        "--",
        manifest.path,
        repository.baseSha,
      ]);
      const ready = worktreeSchema.parse({ ...manifest, state: "ready" });
      await this.verify(ready);
      this.save(ready);
      this.store.recordEvent(
        {
          runId: run.id,
          taskId: task.id,
          attemptId,
          type: "worktree.created",
          correlationId: attemptId,
          payload: {
            path: ready.path,
            branch: ready.branch,
            baseSha: repository.baseSha,
          },
        },
        `worktree:${attemptId}`,
      );
      return ready;
    } catch (error) {
      this.save({ ...manifest, state: "error" });
      throw error;
    }
  }
  private save(manifest: Worktree) {
    this.store.db
      .prepare("UPDATE worktrees SET data=? WHERE attempt_id=?")
      .run(JSON.stringify(worktreeSchema.parse(manifest)), manifest.attemptId);
  }
  async verify(manifest: Worktree) {
    const marker = worktreeSchema.parse(
      JSON.parse(
        await readFile(join(dirname(manifest.path), "ownership.json"), "utf8"),
      ),
    );
    const actual = await inspectRepository(manifest.path);
    if (
      marker.ownerToken !== manifest.ownerToken ||
      marker.attemptId !== manifest.attemptId ||
      marker.path !== manifest.path ||
      actual.root !== manifest.path ||
      actual.commonDirectory !== manifest.repository.commonDirectory ||
      actual.branch !== manifest.branch
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Worktree ownership or repository identity changed; retained for inspection",
      );
  }
  retain(attemptId: string) {
    const item = this.list().find((w) => w.attemptId === attemptId);
    if (item?.state === "ready") this.save({ ...item, state: "retained" });
  }
  async capture(attemptId: string) {
    const item = this.list().find((w) => w.attemptId === attemptId);
    if (!item) throw new DomainError("NOT_FOUND", "Worktree manifest missing");
    await this.verify(item);
    const records = (
      await git(item.path, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignored=matching",
        "--ignore-submodules=none",
      ])
    ).split("\0");
    const files: { path: string; status: string; sensitive: boolean }[] = [];
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record) continue;
      const path = record.slice(3);
      const status = record.slice(0, 2);
      files.push({ path, status, sensitive: sensitivePath(path) });
      if (/[RC]/.test(status)) {
        const old = records[++i];
        if (old)
          files.push({
            path: old,
            status: "rename-source",
            sensitive: sensitivePath(old),
          });
      }
    }
    let diffCheck: "passed" | "failed" = "passed";
    try {
      await git(item.path, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--check",
        item.repository.baseSha,
        "--",
      ]);
    } catch (error) {
      if (!(error instanceof GitError) || error.exitCode !== 2) throw error;
      diffCheck = "failed";
    }
    // Diff stats and status preserve staged/unstaged/untracked evidence without
    // copying potentially secret file contents into reports or the journal.
    return worktreeEvidenceSchema.parse({
      attemptId,
      path: item.path,
      baseSha: item.repository.baseSha,
      headSha: (await git(item.path, ["rev-parse", "HEAD"])).trim(),
      files,
      stagedDiffStat: await git(item.path, [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--stat",
        "--",
      ]),
      unstagedDiffStat: await git(item.path, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--stat",
        "--",
      ]),
      diffCheck,
      tests: "not_run: shell tools are disabled in M3",
    });
  }
}
