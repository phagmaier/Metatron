import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  Attempt,
  RecoveryCheck,
  Repository,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  type Worktree,
  worktreeEvidenceSchema,
  worktreeSchema,
} from "../../shared/worktrees.ts";
import { getIntegrationCandidate } from "../storage/candidates.ts";
import { revisionCandidate } from "../storage/revisions.ts";
import type { Store } from "../storage/store.ts";
import { captureCandidate } from "./candidate.ts";
import { diffCheckPasses, GitError, git } from "./command.ts";
import {
  directoryIdentity,
  inspectRepository,
  requireClean,
  sameRepository,
} from "./inspect.ts";
import { inside, sensitivePath } from "./paths.ts";

const errorCode = (error: unknown) =>
  error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : null;

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
  // Reviews and fresh revisions start at their immutable source candidate.
  startingCandidate(attemptId: string) {
    const task = this.store.getTask(this.store.getAttempt(attemptId).taskId);
    return task.reviewCandidateId
      ? getIntegrationCandidate(this.store, task.reviewCandidateId)
      : revisionCandidate(this.store, task);
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
      !sameRepository(run.repository, repository) ||
      repository.baseSha !== run.repository.baseSha
    )
      throw new DomainError(
        "CONFLICT",
        "Repository identity or base changed or is unverified; reopen the project and start a new run",
      );
    if (
      !["pi", "claude-code", "opencode", "codex"].includes(attempt.adapter) ||
      !attempt.worktreePath ||
      attempt.cwd !== attempt.worktreePath
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Native attempt requires an isolated worktree",
      );
    const reviewed = this.startingCandidate(attemptId);
    if (reviewed) {
      const current = await git(repository.root, [
        "for-each-ref",
        "--format=%(objectname)",
        `refs/heads/lao/candidate-${reviewed.attemptId}`,
      ]);
      if (
        current.trim() !== reviewed.candidateSha ||
        reviewed.baseSha !== repository.baseSha
      )
        throw new DomainError(
          "CONFLICT",
          "Candidate branch or base no longer matches its record; owner review required",
        );
    }
    const startSha = reviewed?.candidateSha ?? repository.baseSha;
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
        startSha,
      ]);
      const ready = worktreeSchema.parse({
        ...manifest,
        state: "ready",
        checkoutIdentity: await directoryIdentity(manifest.path),
      });
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
            startSha,
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
    const source = await inspectRepository(manifest.repository.root);
    if (
      marker.ownerToken !== manifest.ownerToken ||
      marker.attemptId !== manifest.attemptId ||
      marker.path !== manifest.path ||
      !sameRepository(manifest.repository, source) ||
      actual.identity?.commonDirectory !==
        manifest.repository.identity?.commonDirectory ||
      actual.root !== manifest.path ||
      actual.commonDirectory !== manifest.repository.commonDirectory ||
      actual.branch !== manifest.branch ||
      (manifest.checkoutIdentity !== null &&
        (await directoryIdentity(manifest.path)) !== manifest.checkoutIdentity)
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Worktree ownership or repository identity changed; retained for inspection",
      );
  }
  // Observation only: never relinks, repairs or deletes. Same-path existence
  // is not identity; only marker, Git and directory identity together are.
  async observe(attempt: Attempt): Promise<RecoveryCheck["worktree"]> {
    const path = attempt.worktreePath;
    if (!path)
      return {
        path: null,
        state: "not_isolated",
        reason: "This attempt used no app-owned worktree",
        git: null,
      };
    const manifest = this.list().find((w) => w.attemptId === attempt.id);
    const result = (
      state: RecoveryCheck["worktree"]["state"],
      reason: string,
      gitState: RecoveryCheck["worktree"]["git"] = null,
    ) => ({ path, state, reason, git: gitState });
    try {
      const stat = await lstat(path);
      if (!manifest)
        return result(
          "replaced",
          "Something exists at this path, but the app never recorded creating a worktree there",
        );
      if (!stat.isDirectory())
        return result(
          "replaced",
          "The path is no longer a directory; it may be a symlink or file",
        );
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR")
        return result(
          "missing",
          manifest
            ? "The recorded checkout no longer exists. This does not prove the worker stopped."
            : "No worktree was created for this attempt and nothing exists at its path",
        );
      return result(
        "inaccessible",
        `Cannot read the checkout path (${code ?? "unknown error"})`,
      );
    }
    let marker: ReturnType<typeof worktreeSchema.parse>;
    try {
      marker = worktreeSchema.parse(
        JSON.parse(
          await readFile(join(dirname(path), "ownership.json"), "utf8"),
        ),
      );
    } catch (error) {
      const code = errorCode(error);
      return code && code !== "ENOENT"
        ? result("inaccessible", `Cannot read the ownership marker (${code})`)
        : result(
            "replaced",
            "The app ownership marker beside the checkout is missing or invalid",
          );
    }
    if (
      marker.ownerToken !== manifest.ownerToken ||
      marker.attemptId !== attempt.id ||
      marker.path !== path
    )
      return result(
        "replaced",
        "The ownership marker belongs to a different worktree claim",
      );
    if (
      manifest.checkoutIdentity &&
      (await directoryIdentity(path)) !== manifest.checkoutIdentity
    )
      return result(
        "replaced",
        "A different directory now exists at the recorded path; it does not inherit the prior checkout's authority",
      );
    let actual: Repository;
    try {
      actual = await inspectRepository(path);
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      return result(
        "inaccessible",
        `Git cannot read this checkout: ${error.message}`,
      );
    }
    if (
      actual.root !== path ||
      actual.commonDirectory !== manifest.repository.commonDirectory ||
      (manifest.repository.identity !== null &&
        actual.identity?.commonDirectory !==
          manifest.repository.identity.commonDirectory) ||
      actual.branch !== manifest.branch
    )
      return result(
        "replaced",
        "The checkout's Git root, repository or branch differs from the recorded worktree",
      );
    if (!manifest.checkoutIdentity || !manifest.repository.identity)
      return result(
        "unverified",
        manifest.state === "creating" || manifest.state === "error"
          ? "Worktree creation was interrupted before its directory identity was recorded"
          : "This worktree was recorded before directory identity was saved; same-path replacement cannot be ruled out",
      );
    let status: string[];
    try {
      // GIT_OPTIONAL_LOCKS=0 (see git()) keeps status from refreshing the index.
      status = (
        await git(path, [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--ignore-submodules=none",
        ])
      ).split("\0");
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      return result(
        "inaccessible",
        `Git cannot read this checkout: ${error.message}`,
      );
    }
    let changedPaths = 0;
    for (let i = 0; i < status.length; i++) {
      const record = status[i];
      if (!record) continue;
      changedPaths++;
      if (/[RC]/.test(record.slice(0, 2))) i++;
    }
    return result(
      "verified",
      "Ownership marker, Git repository, branch and directory identity match the recorded worktree",
      {
        headSha: actual.baseSha,
        startSha:
          this.startingCandidate(attempt.id)?.candidateSha ??
          manifest.repository.baseSha,
        changedPaths,
      },
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
    const diffCheck = (await diffCheckPasses(item.path, [
      this.startingCandidate(attemptId)?.candidateSha ??
        item.repository.baseSha,
      "--",
    ]))
      ? "passed"
      : "failed";
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
  async candidate(attemptId: string, declaredFiles: readonly string[]) {
    const item = this.list().find((w) => w.attemptId === attemptId);
    if (!item) throw new DomainError("NOT_FOUND", "Worktree manifest missing");
    await this.verify(item);
    const attempt = this.store.getAttempt(attemptId);
    const title = this.store.getTask(attempt.taskId).title.split("\n")[0];
    return captureCandidate(
      item,
      declaredFiles,
      {
        date: attempt.createdAt,
        message: `lao candidate: ${title?.slice(0, 60)}\n\nTask: ${attempt.taskId}\nAttempt: ${attemptId}\n`,
      },
      this.startingCandidate(attemptId)?.candidateSha ??
        item.repository.baseSha,
    );
  }
}
