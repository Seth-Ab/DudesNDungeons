# Herdr Delegation

Read this reference only when `/ticket` is running inside Herdr (`HERDR_ENV=1`) and neither the
invocation nor the environment contains the child guard `TICKET_HERDR_CHILD=1`.

The current agent is the coordinator. Claude in the new tab is the sole implementation agent. The
coordinator must not run the repository workflow in parallel.

## 1. Verify Context and Learn the Installed CLI

Confirm the environment before any Herdr control command:

```bash
test "${HERDR_ENV:-}" = 1
```

If it fails, return to the main ticket workflow in the current agent. Never inspect or control a
focused Herdr session from outside Herdr.

The installed CLI is authoritative. Inspect it before relying on syntax:

```bash
herdr --help
herdr tab
herdr agent
```

Do not run bare `herdr`; it launches or attaches the TUI. Check `herdr status` before relying on a
new server feature. Confirm that `claude` is a supported agent kind. Also verify that
`.claude/skills/ticket/SKILL.md` resolves from the repository working directory, so the child can
invoke the same skill.

## 2. Check Capacity

Apply the parallel-agent cap from `AGENTS.md` before creating anything:

1. Run `herdr agent list` and count every agent it reports, in any workspace, including yourself.
   An idle agent still holds memory, so it counts.
2. If that count is already `${MAX_PARALLEL_AGENTS:-4}` or more, stop.
3. On macOS, run `memory_pressure | tail -1`. If it reports less than 20% free, stop. Skip this
   check where the command does not exist.

When either check stops you, create no tab and start no agent. Report the running agents with their
names and states, the free-memory figure, and say the ticket can start once one finishes. Do not
wait, poll, or fall back to running the ticket in the current agent.

## 3. Create the Tab and Start Claude

Create one tab in the caller's current workspace with the repository's current absolute directory.
Keep the user's focus unchanged when the installed CLI supports doing so. Read the new tab and root
pane IDs from the JSON creation response; never infer them from sidebar order.

Choose a unique agent name matching `[a-z][a-z0-9_-]{0,31}`, preferably `ticket_<issue-number>`.
Inspect `herdr agent list` before choosing a suffix. Start Claude through the agent interface, using
the root pane returned by tab creation:

```text
herdr agent start <unique-name> --kind claude --pane <root-pane-id>
```

Do not start Claude with a raw pane command. `agent start` verifies agent identity and exposes its
working, blocked, idle, and done states. If startup reports `agent_not_ready`, inspect the named
agent and wait for it to become idle instead of starting a second copy.

If tab creation or startup fails, inspect current Herdr state before retrying because a connection
failure does not prove the mutation was not applied. Do not silently fall back to local execution,
create another tab, or close the tab. Report the failure and the IDs of anything already created.

## 4. Delegate the Ticket with a Recursion Guard

Prompt the named Claude agent through `herdr agent prompt`. The submitted prompt must begin with the
skill invocation and include the exact child marker:

```text
/ticket <issue-url> TICKET_HERDR_CHILD=1

You are the delegated implementation agent. Run the complete ticket workflow in this tab. Do not
delegate it through Herdr again. Preserve any additional constraints from the original request.
```

Always include `TICKET_PARENT=<pane-id>`, where the pane id is the coordinator's own `$HERDR_PANE_ID`,
so the child can report back. Also include `TICKET_AUTOCLOSE=1` by default, so the coordinator closes
the tab once the work is verified. Omit it only when the user asked to keep the tab (for example
"keep the tab open" or "I want to inspect it"); the child then still reports back but the coordinator
never closes anything. Say in the handoff report whether auto-close is on.

```text
/ticket <issue-url> TICKET_HERDR_CHILD=1 TICKET_PARENT=<pane-id> TICKET_AUTOCLOSE=1
```

Pass the canonical issue URL and any ticket-specific user constraints. Quote the prompt and URL
safely; do not interpolate issue body text into a shell command. The child marker is part of the
prompt, not proof that a process environment variable was set. The main skill treats either form as
the handoff guard and proceeds locally in the child.

Submit once with a bounded wait, for example `--wait --timeout 60000`. A timeout or stalled response
does not prove the prompt was not delivered. Never resubmit blindly.

## 5. Monitor Without Competing

After submission, the coordinator performs no repository or GitHub mutations. Monitor the named
agent with `herdr agent get`, `herdr agent read --source recent-unwrapped`, and bounded
`herdr agent wait` calls. Give the user a short progress update between waits rather than blocking
silently for long periods.

- `working` means continue waiting.
- `blocked` means inspect the recent output and surface the exact approval or owner question. Do not
  answer it automatically or send raw keys unless the user has authorized that response.
- `unknown` is not completion; inspect output and state.
- `idle` or `done` after observed work means read the final response and verify its claims.

Do not close the tab, pane, workspace, or agent when the delegated run finishes, unless the closing
rule in step 7 applies. The user may want to inspect it.

The child may also send a one-line completion message into the coordinator's input (see the ticket
skill's "Report Completion to the Coordinator"). Treat it as a hint to check now, never as proof.
Verify everything it claims before acting on it.

## 6. Verify and Report the Handoff Result

Read enough unwrapped output to capture Claude's issue URL, branch, commits, PR URL, tests, CI state,
and blockers. When a PR was created, verify it through GitHub before reporting success. If Claude
stopped before opening a PR, report the exact stopping condition and leave recovery to a later prompt
or explicit user direction.

The coordinator's final response should make clear that Claude performed the repository work in the
new Herdr tab and should include the tab, pane, and agent identifiers alongside the normal ticket
handoff details.

## 7. Close the Tab Only After Verification (default on)

Close when the delegated prompt carried `TICKET_AUTOCLOSE=1`, which is the default. When the user
opted out and the marker is absent, report and leave the tab open. Before closing, the coordinator verifies each of these itself, from GitHub and git rather
than from the child's message:

- the PR exists, is open or merged, targets the default branch, and links `Closes #<issue>`;
- required checks have completed successfully (a pending or failing check means leave it open);
- the child's worktree has no uncommitted changes and its branch is pushed;
- `herdr agent get <name>` reports `idle` or `done`, not `working` or `blocked`.

If any check fails, leave the tab open and tell the user which one. If all pass, close the tab with
`herdr tab close <tab-id>` using the tab id from step 3, which also ends the Claude session in it.
Never close a tab or agent that this coordinator did not create. Do not remove the worktree or delete
the branch here; the PR is usually still unmerged, and the prune script handles that after merge.
