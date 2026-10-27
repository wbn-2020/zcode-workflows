# zcode-workflows

ZCode dynamic workflows and project skills for planning and executing reviewed v2 implementation plans.

## Included workflows

- `task-plan` — turns a requirement, report, or findings file into a reviewable `plan.md`.
  - **standard (default)**: lightweight plan; architecture and technical decisions are optional; automated acceptance defaults to non-shell `{ program, args }`.
  - **strict (`strict=true`)**: full requirements, architecture, technical decisions, risk mitigation, and structured acceptance; requires explicit approval after an approving review.
  - **revision (`changes=...`)**: natural-language edits to an existing v2 plan; mode and `allowShell` are inferred from the plan; only affected tasks are re-reviewed; new files/modules/dependencies are gated as `needs-info` or require regeneration.
  - `allowShell=true` enables shell acceptance for standard plans only. It is high risk and never the default. Strict plans reject shell acceptance.
  - The plan embeds a v2 JSON execution contract with `reviewedPlanSnapshot` and `reviewedReviewHash`.
- `task-run` — executes a v2 plan contract.
  - Execution mode comes only from the contract; there is no `strict` argument.
  - Standard plans default to non-shell argv acceptance. Shell acceptance requires `allowShell=true` in both the plan and the run.
  - The executor checks `reviewedPlanSnapshot`, `reviewedReviewHash`, HEAD, stash, plan-file integrity, and task-scope content snapshots.
  - Standard allows unrelated dirty files before execution but still enforces runtime integrity. Strict requires everything except `plan.md` to be clean.
  - Review issues that require confirmation produce a `confirmationToken`; the token binds plan hash, review hash, resolutions, `allowShell`, and confirmation reasons. Reject reviews and unresolved blocking questions are hard errors and cannot be overridden.
  - Standard performs one automatic fix-and-reaccept round after a normal acceptance failure. Strict fails fast without retry.

The matching project skills are under `.agents/skills/`. When this repository is used as a project or its files are copied into a workspace, ZCode can discover the workflows from `.zcode/workflows/` and skills from `.agents/skills/`.

## Usage

1. Create a plan:

   ```text
   /task-plan requirement="..."
   ```

   For a full plan:

   ```text
   /task-plan requirement="..." strict=true
   ```

   For shell acceptance (high risk, standard only):

   ```text
   /task-plan requirement="..." allowShell=true
   ```

2. Review the generated `plan.md`.
   - standard: no separate approval step; the run confirmation is the approval.
   - strict: after an approving final review, set the contract's `approved` to `true` and record blocking-question decisions in `resolutions`.
   - Do not edit the contract's `plan` directly. Use `changes` so the plan and review hashes are refreshed.

3. Revise an existing plan with natural language:

   ```text
   /task-plan planPath=plan.md changes="T2 文件范围收窄到 src/auth，验收换成 npm run test:unit"
   ```

4. Run it:

   ```text
   /task-run planPath=plan.md
   ```

5. If the executor returns a `confirmationToken`, review the listed reasons and rerun with:

   ```text
   /task-run planPath=plan.md confirmationToken=<token>
   ```

## Contract and safety

- `contractVersion` is `2`; v1 contracts are rejected and must be regenerated.
- `reviewedPlanSnapshot` detects unsynchronized plan edits. `reviewedReviewHash` detects modified reviews. They are drift checks, not tamper-proof signatures.
- `confirmationToken` binds plan hash, review hash, resolutions, `allowShell`, and reasons. It is a state binding, not an authentication token.
- Shell acceptance is not an operating-system sandbox. Repository test/build scripts still run with the current user's privileges.
- `task-run` does not auto-rollback. Out-of-scope changes fail the current task and are reported.
- Standard only relaxes the pre-run worktree: unrelated dirty files may remain, but the task's own files must be clean and all runtime integrity checks stay enabled.
- Global copies live in `~/.zcode/workflows/` and `~/.agents/skills/`. The repository copies are the source of truth and should be synced there after validation.
