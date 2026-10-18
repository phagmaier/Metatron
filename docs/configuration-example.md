# Configuration example

Configure roles, profiles, workflows and teams through the GUI; they are persisted in SQLite. This is a worked example of those settings, **not an importable configuration file**. The app does not load `.env`, YAML or a team JSON file. Role JSON import/export is supported separately under **Role templates**.

## Launch environment

From the repository root, after installing the pinned dependencies:

```sh
mise x -- env XDG_DATA_HOME="$HOME/.local/share/metatron-trial" pnpm dev
```

That selects `$HOME/.local/share/metatron-trial/local-agent-orchestrator/` for the database, reports, worktrees and native state. Use the same home when restarting. Keep it outside every managed repo; absolute XDG paths are required (relative values fall back to defaults). Do not run another app/demo against the same database.

Use **Harness setup → Check harnesses → Next step** to authenticate this chosen home. Personal CLI logins are not copied. Supply supported provider credentials privately to the launching process; restarting is required after changing its environment. Never store credential values in a profile, role, workflow or source file. [Authentication details](usage.md#harness-setup).

## Profiles

In **Agent profiles → New profile**, select an existing built-in role and harness, then **Discover profile settings**. Example native selections observed in the M9 acceptance runs were Codex `gpt-6-luna` / `low` and Pi `openai/gpt-6-luna` / `low`. Select these only if fresh discovery offers them and your provider permits access; otherwise choose an available selection deliberately. Discovery does not establish price or entitlement. Null reasoning uses the harness default.

| Profile name | Role | Harness | Permission | Model/thinking |
| --- | --- | --- | --- | --- |
| Trial Lead | Lead | `codex` | `coordinator` | Discovered Codex selection |
| Trial Writer | Backend Engineer | `pi` | `workspace_write` | Discovered Pi selection |
| Trial Reviewer | Reviewer | `pi` | `read_only` | Discovered Pi selection |
| Trial Reader | Reader | `pi` | `read_only` | Discovered Pi selection |
| Trial Synthesizer | Synthesizer | `pi` | `read_only` | Discovered Pi selection |

Leave additional instructions empty initially. Saving profiles revalidates capabilities and launches no work. Do not select the **Fake …** profiles for this team: native and FAKE playback profiles cannot mix. Pi writers have guarded file tools but no per-call approval callback or shell; give them file-editing objectives rather than asking them to run tests.

## Reusable workflows

Under **Team presets → Save a workflow template**, save:

- **Explore Subsystem:** Readers = Trial Reader, Reader count = **2**, Synthesizer = Trial Synthesizer.
- **Review Implementation:** Reviewer = Trial Reviewer.

These forms bind the existing static recipes to your saved profiles; saving starts no workers. The review recipe accepts a captured candidate in the same run. General graph authoring remains a backend API, without a GUI editor.

## Team and limits

Choose **Team presets → New team**. Name it **Trial supervised**, choose Trial Lead, and select all four native workers in **Worker pool**. Select both saved recipes under **Available workflows**. Choose **Supervised** and enter these values:

| GUI field | Example | Application default |
| --- | ---: | ---: |
| Active writers | 1 | 2 |
| Active readers/reviewers | 2 | 4 |
| Total active agents (with Lead) | 3 | 7 |
| Worker launches per run | 6 | 24 |
| Parallel readers per workflow | 2 | 4 |
| Revision cycles per task | 1 | 2 |
| Automatic Lead wake-ups | 4 | 40 |

The corresponding validated `limits` object is:

```json
{
  "maxConcurrentWriters": 1,
  "maxConcurrentReadersReviewers": 2,
  "maxConcurrentAgentsIncludingLead": 3,
  "maxTotalWorkerLaunchesPerRun": 6,
  "maxParallelReadersPerWorkflow": 2,
  "maxRevisionCyclesPerTask": 1,
  "maxAutomaticLeadWakeupsPerRun": 4
}
```

Use the GUI fields above; this JSON documents their API names. It is not a file to place in the repository. **Create team** saves a reusable preset and dispatches nothing. All selected workflow profiles must be in its roster. A stale-save error means reload the library before editing again.

Each workflow reader counts as an individual active agent and each synthesis/review/retry uses worker-launch budget. Two readers plus synthesis require **three launches**, even though the board groups them as one workflow. Active Lead turns also consume the total-agent cap. Reaching a launch/revision/wake limit holds affected work for an owner decision; caps are not a currency budget.

## First run

Open a clean disposable Git repository with a committed branch under **Projects and new runs**. Under **Start a run from a saved team**, reload teams, choose **Trial supervised**, review the saved version and start with a bounded objective such as:

> Propose one small README clarification. Ask the writer to edit only README.md and submit a report. Request independent review before proposing integration. Do not ask file-tool workers to run shell commands.

Starting calls a real Codex Lead. In Supervised mode its proposed worker task waits for your **Assign / approve**; explicitly starting a workflow also authorizes its children. For an investigation, use **Workflows → Run a saved workflow → Explore Subsystem**, supply a `target`, and inspect the reader reports and synthesis citations. Change the run to Chat/Plan to prohibit worker dispatch, or to Autonomous (bounded) only when you want scheduling within the saved caps.

Library edits affect future runs. To change the roster, workflows or saved limits for a new experiment, save the team and start a new run; an existing run keeps its immutable configuration snapshot. Read the [review, integration and recovery steps](usage.md) before approving source changes.
