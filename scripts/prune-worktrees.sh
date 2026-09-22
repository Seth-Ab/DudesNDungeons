#!/usr/bin/env bash
# Remove git worktrees left over from finished /ticket runs.
#
# A worktree is only removed when its branch's pull request has merged (checked
# via `gh`, falling back to an ancestor-of-main check when `gh` isn't available)
# and the worktree itself has no uncommitted changes. Anything else is reported
# and left alone.
#
# Usage:
#   scripts/prune-worktrees.sh          # remove eligible worktrees
#   scripts/prune-worktrees.sh --dry-run  # only report what would be removed

set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

MAIN_WORKTREE="$(git rev-parse --show-toplevel)"
HAVE_GH=0
if command -v gh >/dev/null 2>&1; then
  HAVE_GH=1
fi

git fetch origin --prune -q || true

removed=0
kept=0

# git worktree list --porcelain emits blank-line separated records like:
#   worktree /path
#   HEAD <sha>
#   branch refs/heads/<name>
while IFS= read -r line; do
  case "$line" in
    worktree\ *) wt_path="${line#worktree }" ;;
    branch\ *)
      branch="${line#branch refs/heads/}"
      ;;
    "")
      if [[ -n "${wt_path:-}" && "$wt_path" != "$MAIN_WORKTREE" ]]; then
        if [[ -z "${branch:-}" ]]; then
          echo "skip: $wt_path (detached HEAD, not a ticket worktree)"
        else
          reason=""
          mergeable=0

          if [[ $HAVE_GH -eq 1 ]]; then
            state="$(gh pr list --state all --head "$branch" --json state --jq '.[0].state // empty' 2>/dev/null || true)"
            if [[ "$state" == "MERGED" ]]; then
              mergeable=1
              reason="PR for $branch is merged"
            fi
          fi

          if [[ $mergeable -eq 0 ]]; then
            tip="$(git -C "$wt_path" rev-parse HEAD 2>/dev/null || true)"
            if [[ -n "$tip" ]] && git merge-base --is-ancestor "$tip" origin/main 2>/dev/null; then
              mergeable=1
              reason="$branch is merged into origin/main"
            fi
          fi

          if [[ $mergeable -eq 0 ]]; then
            echo "keep: $wt_path ($branch not confirmed merged)"
          elif [[ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]]; then
            echo "keep: $wt_path ($branch is merged but has uncommitted changes)"
            kept=$((kept + 1))
          else
            if [[ $DRY_RUN -eq 1 ]]; then
              echo "would remove: $wt_path ($reason)"
            else
              echo "removing: $wt_path ($reason)"
              git worktree remove "$wt_path"
            fi
            removed=$((removed + 1))
          fi
        fi
      fi
      wt_path=""
      branch=""
      ;;
  esac
done < <(git worktree list --porcelain; echo)

echo "---"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "$removed worktree(s) would be removed."
else
  echo "$removed worktree(s) removed."
fi
[[ $kept -gt 0 ]] && echo "$kept worktree(s) left in place (uncommitted changes)."
exit 0
