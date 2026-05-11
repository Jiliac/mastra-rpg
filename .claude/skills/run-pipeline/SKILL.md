---
name: run-pipeline
description: Run the autonomous dev pipeline that drives one spec phase through plan → review → implement → review × 3 → PR with two human checkpoints (plan approval, final merge). Use when the user says "run pipeline for <spec-ref>", "/run-pipeline ...", "approve plan for <ticket>", "/approve-plan ...", "cancel pipeline <ticket>", "/cancel-pipeline ...", "resume pipeline", "resume pipelines", or when the literal sentinel `<<run-pipeline-tick>>` appears as a prompt (ScheduleWakeup re-entry).
---

# run-pipeline — autonomous dev pipeline orchestrator

This skill is the brain of the autonomous dev pipeline (spec `docs/specs/0002-autonomous-dev-pipeline.md`). One Claude Code session per ticket. The skill detects four entry modes from the prompt shape, advances a phase state machine, and re-arms itself via `ScheduleWakeup` until terminal.

## Entry-mode dispatcher (ALWAYS run first)

Inspect the user prompt that triggered this skill and pick **exactly one** branch:

| Prompt pattern                                                  | Mode     | Branch   |
| --------------------------------------------------------------- | -------- | -------- |
| Literal sentinel `<<run-pipeline-tick>>` (whole prompt)         | tick     | §3       |
| `/run-pipeline …`, `run pipeline for …`, `start pipeline for …` | kickoff  | §1       |
| `/approve-plan …`, `approve plan for …`, `approve <ticket>`     | approval | §2       |
| `/cancel-pipeline …`, `cancel pipeline <ticket>`                | cancel   | §4.5     |
| `resume pipeline`, `resume pipelines`                           | resume   | §4       |
| anything else                                                   | clarify  | ask user |

If `clarify`: ask "Did you mean to run, approve, or resume the pipeline? Provide a spec-ref or ticket-id." and stop.

**Non-negotiable:** Every non-terminal mode MUST end the turn with a `ScheduleWakeup` call (or, in approval mode, an immediate one). The only exceptions are `clarify` and runs where every active ticket is already in a terminal phase (`merged`, `escalated`, or Phase-1 `done`).

## Conventions used throughout

- Repo root and helpers are reached via `.claude/scripts/pipeline-helpers.sh` (sourceable + CLI).
- State for ticket `<id>` lives at `.autonomous/<id>/state.json`. The `.autonomous/` dir is gitignored.
- All Bash invocations in this skill assume the orchestrator session's CWD is the repo root.
- "Notify the human" means `.claude/scripts/notify-human.sh "<title>" "<message>"`. Always best-effort; never block on it.
- Phase transitions write to `state.log` (append-only) and bump `state.updated_at`. Always use the `transition_phase`, `set_state_field`, `bump_counter`, `append_log` helpers — never hand-edit JSON.
- **Triage reviewer feedback — never apply blindly.** Plan reviewers, superpowers reviewers, CodeRabbit, and `code-review-val` are sometimes wrong on details they can't verify (runtime behavior, framework idioms, project conventions, whether a "missing" fallback is actually intentional). Treat every finding as a hypothesis to check against the current code. Fix-up Agents must classify each finding into Apply / Skip / Ambiguous, fix the valid ones, and record reasons for the skipped ones in the agent's return summary. The `handle-coderabbit` skill captures this protocol — fix-up Agents for any review phase should follow that same triage discipline. Iteration counters (`global_review_rounds`, per-gate `iteration`) bump on fix-up _dispatch_, not on the number of findings; over-zealous reviewers don't get to burn the cap on noise.

### Bash environment & required tools

| Tool         | Used in phase                | Notes                                                   |
| ------------ | ---------------------------- | ------------------------------------------------------- |
| `git`, `gh`  | implement, review-coderabbit | `gh auth status` must be green                          |
| `coderabbit` | review-cr                    | invoke as `coderabbit --agent --base main`              |
| `python3`    | helpers                      | macOS default — used to validate JSON + format payloads |
| `osascript`  | notify-human.sh              | macOS default — silent fallback if missing              |

Sub-agents are launched via the `Agent` tool (`Task()` in older docs).

**Worktree mode (default = in-tree):** by default, agents run **without** `isolation: "worktree"` — they execute directly in the orchestrator's current worktree on a feature branch named `auto/<TICKET>`. This keeps work visible in `git status`, avoids hash-named sibling directories, and respects the user's existing per-feature worktree setup (the user typically already created a dedicated worktree for the feature before invoking this skill).

**Isolated mode (opt-in):** if the kickoff prompt contains `--isolated` (e.g. `/run-pipeline <spec-ref> --isolated`), agents are dispatched with `isolation: "worktree"` and a temporary hash-named worktree is spawned per agent dispatch. Use only when the user has not pre-created a dedicated worktree and parallel editing is required.

The mode is decided once at kickoff and persisted in `state.work_mode` (`"in-tree" | "isolated"`). All later phase agents must respect it.

---

## §1. Kickoff mode

Triggered when the user starts a new ticket.

### 1.1 Parse the spec-ref and worktree-mode flag

Extract the spec-ref from the prompt. Examples:

- `run pipeline for docs/specs/0002-autonomous-dev-pipeline.md#phase-1`
- `/run-pipeline docs/specs/0001-agno-for-coaching-pipeline.md#phase-3`
- `/run-pipeline <spec-ref> --isolated` (opt-in: spawn temporary worktrees per agent)
- `run pipeline for test-smoke` (Phase-1 fake target — no real spec required)

Spec-ref = whatever follows the trigger phrase, with `--isolated` stripped. Trim whitespace.

Worktree mode:

- If the prompt contains `--isolated`, set `WORK_MODE=isolated`.
- Otherwise `WORK_MODE=in-tree` (default).

### 1.2 Ticket id, collision check, branch safety check, initial phase

```bash
TICKET=$(.claude/scripts/pipeline-helpers.sh ticket_id_from_spec_ref "$SPEC_REF")
STATE_PATH=$(.claude/scripts/pipeline-helpers.sh state_path "$TICKET")
```

If `$STATE_PATH` already exists: tell the user "Ticket $TICKET is already active (phase: <phase>). Use `resume pipeline` to continue, or `rm -rf .autonomous/$TICKET/` to restart." Stop.

**Branch safety check (in-tree mode only).** When `WORK_MODE=in-tree`:

```bash
CURRENT_BRANCH=$(git symbolic-ref --short HEAD)
```

- If `CURRENT_BRANCH` is `main` or `master`: do **not** start. Tell the user: "You're on `$CURRENT_BRANCH`. Pick: (a) create a feature branch and re-run, (b) re-run with `--isolated` to spawn a temporary worktree." Stop.
- Otherwise: keep `CURRENT_BRANCH` as the parent branch. The implementer will create `auto/<TICKET>` on top of it (or check it out if it already exists).

Initial phase: `plan_fake` if the spec-ref is exactly `test-smoke` (Phase-1 dry-run target), else `plan`. **Initialise state.json BEFORE any `set_state_field` calls** — those helpers expect the file to exist.

```bash
INITIAL_PHASE=$([ "$SPEC_REF" = "test-smoke" ] && echo plan_fake || echo plan)
.claude/scripts/pipeline-helpers.sh init_state "$TICKET" "$SPEC_REF" "$INITIAL_PHASE"
```

Then persist the chosen mode and branch:

```bash
.claude/scripts/pipeline-helpers.sh set_state_field "$TICKET" work_mode "\"$WORK_MODE\""

if [ "$WORK_MODE" = "in-tree" ]; then
  .claude/scripts/pipeline-helpers.sh set_state_field "$TICKET" parent_branch "\"$CURRENT_BRANCH\""
  .claude/scripts/pipeline-helpers.sh set_state_field "$TICKET" work_branch "\"auto/$TICKET\""
  .claude/scripts/pipeline-helpers.sh set_state_field "$TICKET" worktree_path "\"$(pwd)\""
fi
# In isolated mode, worktree_path stays null until the plan-writer Agent
# creates the temp worktree and returns its path.
```

### 1.3 Notify + arm the loop

Tell the user briefly: "Started pipeline for `<spec-ref>` as ticket `<ticket>` (phase: <initial-phase>). Self-scheduling at 60s."

Call `ScheduleWakeup` with:

- `delaySeconds`: 60
- `reason`: "first tick after kickoff for $TICKET"
- `prompt`: the literal string `<<run-pipeline-tick>>`

End turn.

---

## §2. Approval mode

Triggered by "approve plan for <ticket>" or `/approve-plan <ticket>`.

1. Parse the ticket id (everything after the trigger phrase, trimmed). If empty and exactly one ticket has phase `awaiting-plan-approval`, use that one. Otherwise list candidates and ask which.
2. Read state. If `phase != awaiting-plan-approval`, refuse: "Ticket $TICKET is in phase <phase>, not awaiting approval. Cannot approve." Stop.
3. Approve and transition:
   ```bash
   .claude/scripts/pipeline-helpers.sh set_state_field "$TICKET" gate1_approved true
   .claude/scripts/pipeline-helpers.sh transition_phase "$TICKET" implement "gate1_approved"
   ```
4. Tell the user: "Plan approved for `<ticket>`. Resuming pipeline now."
5. `ScheduleWakeup` with `delaySeconds: 60`, `prompt: <<run-pipeline-tick>>`, `reason: "gate-1 approved for $TICKET, advancing to implement"`. End turn.

---

## §3. Tick mode

Triggered by the literal sentinel `<<run-pipeline-tick>>` as the entire prompt. This is how `ScheduleWakeup` re-enters the orchestrator.

Process **all** active tickets but advance **at most one phase per tick** to keep the orchestrator session lean. Pick the first ticket whose phase is non-terminal. After acting on it, schedule the next wake (60s for active phases, 1200s for `awaiting-*` idle phases, 300s for `review-coderabbit` while polling for CodeRabbit comments).

### 3.1 Find work

```bash
TICKETS=$(.claude/scripts/pipeline-helpers.sh list_active_tickets)
```

For each ticket: read state. Skip terminal (`merged`, `escalated`, `done`). If none remain non-terminal: notify "All pipelines terminal — orchestrator stopping." and **do not** call `ScheduleWakeup`. End turn.

### 3.2 Phase machine (top-level lookup)

| Phase                    | Action (see §3.4 for details)                                                                                                                                               | Next on success                                                      | On failure / cap exceeded                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| `plan_fake`              | Phase-1 smoke: log "fake plan complete"                                                                                                                                     | `done`                                                               | n/a                                              |
| `plan`                   | Dispatch plan-writer Agent (pass `isolation: "worktree"` only when `state.work_mode == "isolated"`; see §3.4). Save worktree path + plan path on return.                    | `plan-review`                                                        | iteration cap → `escalated`                      |
| `plan-review`            | Dispatch plan-reviewer Agent (read-only). Parse JSON `{verdict, feedback}` from last line.                                                                                  | `awaiting-plan-approval` if APPROVED, else back to `plan` (revision) | iteration cap (3) → `escalated`                  |
| `awaiting-plan-approval` | Idle. Notify human ONCE on entry. Do not advance until §2 flips `gate1_approved=true`. Timeout: 48h (172800s) → `escalated`.                                                | (no auto advance — wait)                                             | 48h timeout → `escalated`                        |
| `implement`              | Dispatch implement Agent (pass `isolation: "worktree"` only when `state.work_mode == "isolated"`; reuse worktree from plan/kickoff). See §3.4.                              | `review-superpowers`                                                 | iteration cap → `escalated`                      |
| `review-superpowers`     | Dispatch reviewer (`/superpowers:requesting-code-review`). On findings, dispatch fix-up + bump `global_review_rounds`.                                                      | `review-cr` when clean                                               | per-gate cap (3) or global cap (6) → `escalated` |
| `review-cr`              | Bash: `coderabbit --agent --base main`. On findings, dispatch fix-up + bump `global_review_rounds`.                                                                         | `review-coderabbit` when clean                                       | per-gate cap or global cap → `escalated`         |
| `review-coderabbit`      | If no PR yet: `gh pr create`. Then poll PR review comments via `gh api`. On findings: fix-up Agent referencing `handle-coderabbit`. Timeout: 30 min total (6 polls @ 300s). | `awaiting-human-review`                                              | per-gate cap or global cap → `escalated`         |
| `awaiting-human-review`  | Idle. Notify human ONCE on entry with PR URL. Each tick polls `gh pr view --json mergedAt`. Timeout: 48h (172800s) → `escalated`.                                           | `merged` when `mergedAt != null`                                     | 48h timeout → `escalated`                        |
| `merged`                 | Terminal. Notify "merged".                                                                                                                                                  | n/a                                                                  | n/a                                              |
| `escalated`              | Terminal. Notify "escalated".                                                                                                                                               | n/a                                                                  | n/a                                              |
| `done`                   | Phase-1 terminal smoke. Notify "smoke test complete".                                                                                                                       | n/a                                                                  | n/a                                              |

**Global review-round cap:** before entering any review-\* phase action, check `state.global_review_rounds`. If ≥6, transition to `escalated` instead. Bump the counter once per fix-up dispatch.

### 3.3 Common per-tick boilerplate

After choosing a ticket and computing its action:

1. Run the action (may dispatch one Agent and wait for it).
2. Apply state mutations via helpers (`transition_phase`, `set_state_field`, `bump_counter`, `append_log`).
3. Notify human iff the new phase is one of: `awaiting-plan-approval`, `awaiting-human-review`, `escalated`, `done`, `merged`.
4. `ScheduleWakeup` with the right delay (table below) and `prompt: <<run-pipeline-tick>>`. Skip only if every ticket is terminal.

| Outgoing phase                                                        | Delay (s) |
| --------------------------------------------------------------------- | --------- |
| `plan`, `plan-review`, `implement`, `review-superpowers`, `review-cr` | 60        |
| `review-coderabbit` (poll wait)                                       | 300       |
| `awaiting-plan-approval`, `awaiting-human-review`                     | 1200      |
| terminal-but-other-tickets-alive                                      | 60        |

### 3.4 Phase action recipes

#### `plan_fake` (Phase-1 smoke)

```bash
.claude/scripts/pipeline-helpers.sh transition_phase "$TICKET" done "fake plan complete (smoke)"
```

#### `plan`

1. **Worktree path:**
   - In-tree mode (`state.work_mode == "in-tree"`): `worktree_path` was set at kickoff to the orchestrator's CWD; reuse it.
   - Isolated mode (`state.work_mode == "isolated"`): if `state.worktree_path` is null, the Agent's `isolation: "worktree"` will create one and return its path; capture and persist it.
2. Read prior reviewer feedback if `state.iteration > 0` (last `plan-review` log entry's `feedback` field).
3. Dispatch `Agent` with `subagent_type: "general-purpose"`. Pass `isolation: "worktree"` **only** when `state.work_mode == "isolated"`. Prompt:

   ```
   You are the plan-writer for autonomous dev ticket <TICKET>.

   Read spec section: <SPEC_REF>
   Use the /superpowers:writing-plans skill end-to-end. The plan you produce
   must be saved under `docs/superpowers/plans/` using the convention
   `YYYY-MM-DD-<ticket>.md` (e.g. `docs/superpowers/plans/2026-05-02-0001-agno-for-coaching-pipeline-phase-3.md`)
   and committed on a feature branch named `auto/<TICKET>`.

   Iteration: <N>. Reviewer feedback from previous iteration (if any):
   <FEEDBACK or "n/a">

   Stop after committing the plan file. Do NOT push, do NOT open a PR, do
   NOT advance the pipeline yourself. Return a one-line summary plus two
   labelled lines:

       WORKTREE_PATH: <absolute worktree path>
       PLAN_PATH: <absolute path to the committed plan file>
   ```

4. Parse the agent's reply for `WORKTREE_PATH:` and `PLAN_PATH:`. Persist via `set_state_field $TICKET worktree_path "\"<worktree>\""` and `set_state_field $TICKET plan_path "\"<plan>\""`. If `PLAN_PATH:` is missing, fall back to the most recent file in `<worktree>/docs/superpowers/plans/` whose basename matches the regex `^[0-9]{4}-[0-9]{2}-[0-9]{2}-${TICKET}\.md$` exactly (lexicographic sort, take the last entry — substring/prefix matches must NOT be used because ticket ids can share prefixes, e.g. `…phase-3` vs `…phase-30`). If no candidate matches, escalate.
5. `transition_phase $TICKET plan-review "plan written"`.

#### `plan-review`

0. Resolve and validate the plan path before dispatch. Resumed/legacy tickets may have a null `plan_path` and would otherwise feed a malformed prompt to the reviewer agent.

   ```bash
   PLAN_PATH=$(.claude/scripts/pipeline-helpers.sh get_state_field "$TICKET" plan_path | python3 -c 'import json,sys; v=json.loads(sys.stdin.read() or "null"); print(v or "")')
   if [ -z "$PLAN_PATH" ] || [ ! -f "$PLAN_PATH" ]; then
     .claude/scripts/pipeline-helpers.sh set_state_field "$TICKET" escalation_reason '"plan_path missing or unreadable at plan-review"'
     .claude/scripts/pipeline-helpers.sh transition_phase "$TICKET" escalated "missing plan path"
     # notify human and end the tick — do NOT dispatch the reviewer.
   fi
   ```

1. Dispatch `Agent` (no isolation, read-only):

   ```
   You are the plan-reviewer for ticket <TICKET>.

   Read the plan at <PLAN_PATH> (resolved above from `state.plan_path`) and the spec section <SPEC_REF>.
   Critique the plan: feasibility, completeness, risk identification, scope
   creep, missing edge cases, and alignment with project conventions.

   Return a single JSON object on the LAST line of your reply:
   {"verdict": "APPROVED" | "NEEDS_REVISION", "feedback": "<bullet list as one string>"}

   Do not edit files. Tools allowed: Read, Grep, Glob.
   ```

2. Parse the LAST JSON object from the agent's reply (use `python3` with a regex to extract the trailing `{...}`).
3. If `APPROVED`:
   - `transition_phase $TICKET awaiting-plan-approval "plan approved by reviewer"`
4. If `NEEDS_REVISION`:
   - Append feedback to log: `append_log $TICKET "review_feedback" '{"feedback": "<text>"}'`
   - `bump_counter $TICKET iteration` → if returned ≥3, `transition_phase $TICKET escalated "plan iteration cap reached"` and stop.
   - Else `transition_phase $TICKET plan "revision requested"` so next tick re-runs plan with feedback.

#### `awaiting-plan-approval`

- If `state.gate1_approved == true` (could be set by §2 between ticks): `transition_phase implement "gate1 approved"`.
- Else if `pipeline-helpers.sh check_timeout $TICKET phase_entered_at_awaiting-plan-approval 172800` exits 0 (48h elapsed): `set_state_field $TICKET escalation_reason '"plan-approval timeout (48h)"'`, `transition_phase $TICKET escalated "timeout"`, notify human, end.
- Else: notify human ONCE if no prior `awaiting-plan-approval` notification in `state.log` (look for `{event: "human_notified_gate1"}`); after notifying, `append_log $TICKET human_notified_gate1`. Schedule next wake at 1200s. End.

#### `implement`

0. Resolve and validate the approved plan path before dispatch. The implement agent's prompt references `<PLAN_PATH>`; a null/missing value would feed it a malformed pointer.

   ```bash
   PLAN_PATH=$(.claude/scripts/pipeline-helpers.sh get_state_field "$TICKET" plan_path | python3 -c 'import json,sys; v=json.loads(sys.stdin.read() or "null"); print(v or "")')
   if [ -z "$PLAN_PATH" ] || [ ! -f "$PLAN_PATH" ]; then
     .claude/scripts/pipeline-helpers.sh set_state_field "$TICKET" escalation_reason '"plan_path missing or unreadable at implement"'
     .claude/scripts/pipeline-helpers.sh transition_phase "$TICKET" escalated "missing plan path"
     # notify human and end the tick — do NOT dispatch the implementer.
   fi
   ```

1. Reuse `state.worktree_path`. If null (shouldn't happen — kickoff or plan phase set it), escalate.
2. Dispatch `Agent`. Pass `isolation: "worktree"` **only** when `state.work_mode == "isolated"` (in-tree mode runs the agent directly in the orchestrator's worktree). For isolated mode, reusing the existing worktree path is platform-dependent — if a fresh worktree is created on each Agent call, the implement prompt MUST first `git fetch && git checkout auto/<TICKET>` to land on the planning branch:

   ```
   You are the implementer for ticket <TICKET>.

   Worktree: <WORKTREE> (already contains the approved plan at <PLAN_PATH> on branch auto/<TICKET>).
   Use /superpowers:executing-plans to drive implementation. Commit logically.

   Iteration: <N>. Reviewer feedback to address (if any): <FEEDBACK or "n/a">.
   TRIAGE that feedback — apply only the items that are actually correct
   against the current code/plan. Skip noise, push back on items that
   misread the design. Reviewers are sometimes wrong; verify before changing.

   Stop when the plan is fully implemented and tests pass locally. Do NOT
   push, do NOT open a PR. Return a one-line summary of what was committed.
   ```

3. On Agent success: `transition_phase $TICKET review-superpowers "implementation complete"`.
4. On Agent failure: `bump_counter $TICKET iteration`; if ≥3, escalate.

#### `review-superpowers`

1. **Cap check:** if `global_review_rounds ≥ 6`, escalate.
2. Dispatch `Agent` (no isolation, read-only):

   ```
   You are reviewing the implementation at <WORKTREE> for ticket <TICKET>.
   Use /superpowers:requesting-code-review to evaluate the changes.

   Return a single JSON object on the LAST line:
   {"verdict": "APPROVED" | "NEEDS_REVISION", "findings": "<text>"}
   ```

3. If APPROVED → `transition_phase $TICKET review-cr "superpowers review clean"`.
4. If NEEDS_REVISION:
   - `bump_counter $TICKET iteration` and `bump_counter $TICKET global_review_rounds`.
   - If iteration ≥3 OR global ≥6 → escalate.
   - Else dispatch fix-up Agent (pass `isolation: "worktree"` **only** when `state.work_mode == "isolated"`):

     ```
     You are applying review feedback to ticket <TICKET>.
     Worktree: <WORKTREE>. Feedback to address: <FINDINGS>

     TRIAGE FIRST — DO NOT APPLY BLINDLY. For each finding, classify as
     Apply / Skip / Ambiguous. Verify against the current code; reviewers
     are sometimes wrong on details they can't observe (runtime behavior,
     project conventions, intentional fallbacks). Apply minimal, surgical
     fixes for valid findings only. Re-run relevant tests. Commit. Do NOT
     push. Return a one-line summary: "applied N, skipped M (reasons:
     ...), ambiguous K (need user input on: ...)".
     ```

   - Stay in `review-superpowers` for next tick.

#### `review-cr`

1. Cap check (global ≥6 → escalate).
2. Run in the worktree via `bash -c 'cd <WORKTREE> && coderabbit --agent --base main --json' > /tmp/cr-<TICKET>.json` (best-effort; coderabbit's output format may vary — fall back to plain text).
3. If output indicates 0 findings → `transition_phase $TICKET review-coderabbit "cr local clean"`.
4. Else dispatch fix-up Agent with the findings (same triage discipline as `review-superpowers` — verify each finding before applying, classify Apply/Skip/Ambiguous, return a triage summary); bump counters; stay in phase.

#### `review-coderabbit`

1. If no PR yet (`state.pr_url == null`):
   - `bash -c 'cd <WORKTREE> && git push -u origin auto/<TICKET>'`
   - `gh pr create` does NOT support `--json` (only `gh pr view`/`pr list` do). Two-step: capture the PR URL printed to stdout, then look up the number.

     ```bash
     PR_URL=$(bash -c 'cd <WORKTREE> && gh pr create --base main --head auto/<TICKET> --title "auto: <TICKET>" --body "Autonomous dev pipeline for spec <SPEC_REF>."')
     PR_NUMBER=$(gh pr view "$PR_URL" --json number -q '.number')
     ```

     **Open as a normal (non-draft) PR.** CodeRabbit does not review draft PRs by default, so opening as draft would silently skip the entire `review-coderabbit` phase. If you need a draft for any reason, mark it ready before this phase polls.

   - `set_state_field $TICKET pr_url "\"$PR_URL\""` and `set_state_field $TICKET pr_number $PR_NUMBER`.
   - `append_log $TICKET pr_opened`. Schedule next tick at 300s. End.

2. PR exists: poll comments.
   - `gh api repos/{owner}/{repo}/pulls/<NUM>/comments --paginate > /tmp/cr-pr-<TICKET>.json`
   - Filter for CodeRabbit findings without a human reply (see `handle-coderabbit` skill).
   - Track polls: maintain `state.cr_poll_count` (init 0). Bump each tick. After 6 polls (≈30 min) with 0 findings → `transition_phase $TICKET awaiting-human-review "no CodeRabbit findings"`.
   - If findings: dispatch fix-up Agent referencing the `handle-coderabbit` skill pattern; bump counters; reset `cr_poll_count` to 0. Stay in phase.

#### `awaiting-human-review`

- Notify ONCE on entry (look for `human_notified_pr_ready` in log).
- Each tick: `gh pr view <NUM> --json mergedAt -q '.mergedAt'`. If non-empty → `transition_phase merged "PR merged"`. Schedule next at 1200s.
- Timeout: if `pipeline-helpers.sh check_timeout $TICKET phase_entered_at_awaiting-human-review 172800` exits 0 (48h), `set_state_field $TICKET escalation_reason '"PR-merge timeout (48h)"'`, `transition_phase $TICKET escalated "timeout"`, notify human, end.

#### `merged` / `escalated` / `done`

- Notify if a `terminal_notify_<phase>` log entry doesn't exist; then add it.
- Do NOT schedule another wake unless other tickets are alive.

### 3.5 Error handling & retries

For every Agent dispatch and every Bash call inside a tick:

- On failure, retry up to **3 times total** for that phase action.
- Track retries via `state.retry_count` (init 0; reset on phase change).
- After 3 failures: `set_state_field $TICKET escalation_reason "<short text>"`, `transition_phase $TICKET escalated "retry cap"`, notify human.

---

## §4. Resume mode

Triggered by "resume pipeline" or "resume pipelines".

1. `TICKETS=$(.claude/scripts/pipeline-helpers.sh list_active_tickets)`
2. For each ticket: read state, summarize `phase`, `iteration`, `global_review_rounds`, last 2 log entries.
3. Print a one-line summary per ticket.
4. If any are non-terminal: `ScheduleWakeup` 60s with sentinel; the next tick handles them normally. End turn.
5. If all terminal: tell the user "No active pipelines. Use `rm -rf .autonomous/<id>/` to clean up." Do not arm.

---

## §4.5 Cancel mode

Triggered by `/cancel-pipeline <ticket>` or `cancel pipeline <ticket>`.

1. Parse ticket id from prompt. If empty, list active tickets and ask which.
2. Verify ticket has a state file. If not, tell user "No active pipeline for `<ticket>`." and stop.
3. Optional reason after the ticket id (everything after the id is the reason; default `"cancelled by user"`).
4. Run `.claude/scripts/pipeline-helpers.sh cancel_pipeline $TICKET "$REASON"`. This sets `escalation_reason` and transitions the phase to `escalated`.
5. Notify human: "Pipeline `<ticket>` cancelled: `<reason>`. Worktree at `<path>` left in place — clean up manually if desired."
6. Do NOT `ScheduleWakeup` — the ticket is now terminal. If other tickets are still active, schedule with sentinel; otherwise end.

---

## §5. Termination contract

The orchestrator stops self-scheduling **only** when:

- All active tickets are in terminal phases (`merged`, `escalated`, or `done`), OR
- No `.autonomous/` directory exists, OR
- An unrecoverable error after 3 retries — escalate the affected ticket and continue scheduling for the rest. Stop the loop only if no tickets remain alive.

Every other turn must end with a `ScheduleWakeup`. Forgetting to schedule is the single most common failure mode of this skill — guard against it.

---

## Appendix A. State schema

```json
{
  "ticket_id": "<slug>",
  "spec_ref": "<spec-ref>",
  "phase": "<one of the table above>",
  "iteration": 0,
  "global_review_rounds": 0,
  "gate1_approved": false,
  "work_mode": "in-tree",
  "parent_branch": "feature/foo",
  "work_branch": "auto/<ticket_id>",
  "worktree_path": "/abs/path/to/worktree",
  "plan_path": null,
  "pr_url": null,
  "pr_number": null,
  "cr_poll_count": 0,
  "retry_count": 0,
  "escalation_reason": null,
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "log": [{"at": "ISO8601", "event": "<msg>", ...}]
}
```

Notes:

- `work_mode`: `"in-tree"` (default) or `"isolated"`; set at kickoff (§1.2).
- `parent_branch`, `work_branch`, `worktree_path`: set at kickoff in in-tree mode. In isolated mode `parent_branch` and `work_branch` stay null and `worktree_path` stays null until the first plan-writer Agent dispatch returns the spawned worktree path.

Fields beyond `init_state`'s default are added on demand via `set_state_field`.

## Appendix B. Reuse cheatsheet

| Need                             | Reuse                                                            |
| -------------------------------- | ---------------------------------------------------------------- |
| `gh api` PR comment polling      | `.claude/skills/handle-coderabbit/SKILL.md` — exact same pattern |
| Background bash + status polling | `.claude/skills/run-evals/SKILL.md`                              |
