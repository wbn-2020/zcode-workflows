# zcode-workflows

ZCode dynamic workflows and project skills for planning and executing reviewed implementation plans.

## Included workflows

- `task-plan`: inspects the repository and writes a detailed, unapproved `plan.md` with requirements, architecture, technical decisions, risks, tasks, and acceptance criteria.
- `task-run`: executes only an explicitly approved versioned plan contract, validates task dependencies, runs allowlisted argv-based acceptance commands, and checks Git and ignored-file changes against task scopes.

The matching project skills are under `.agents/skills/`. When this repository is used as a project or its files are copied into a workspace, ZCode can discover the workflows from `.zcode/workflows/` and skills from `.agents/skills/`.

## Usage

1. Run the `task-plan` skill with a product requirement or engineering report.
2. Review the generated plan and resolve blocking questions in the execution contract.
3. Set only the contract's `approved` field to `true` after approval.
4. Run the `task-run` skill against that plan.

`task-run` does not execute arbitrary shell command strings. Project test and build scripts still run with the current user's permissions; this is not an operating-system sandbox. See each skill's `SKILL.md` for the full contract and safety boundaries.
