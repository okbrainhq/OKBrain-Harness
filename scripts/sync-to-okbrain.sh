#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/sync-to-okbrain.sh [options]

Sync all files from this Brain repo into the sibling OkBrain repo,
then create a single commit in OkBrain.

Options:
  --target <path>          Target repo path (default: ../OkBrain)
  --message <text>         Commit message
                           (default: "Sync app state from brain")
  --dry-run                Show what would change without writing or committing
  --allow-dirty-target     Skip clean-working-tree check on target repo
  -h, --help               Show this help
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_REPO="$(cd "${BRAIN_ROOT}/.." && pwd)/OkBrain"
COMMIT_MESSAGE="Sync app state from brain"
DRY_RUN=0
ALLOW_DIRTY_TARGET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -lt 2 ]] && { echo "Error: --target requires a value" >&2; exit 1; }
      TARGET_REPO="$2"
      shift 2
      ;;
    --message)
      [[ $# -lt 2 ]] && { echo "Error: --message requires a value" >&2; exit 1; }
      COMMIT_MESSAGE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --allow-dirty-target)
      ALLOW_DIRTY_TARGET=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if ! git -C "${BRAIN_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: ${BRAIN_ROOT} is not a git repository." >&2
  exit 1
fi

if [[ ! -d "${TARGET_REPO}" ]]; then
  echo "Error: target path does not exist: ${TARGET_REPO}" >&2
  exit 1
fi

if ! git -C "${TARGET_REPO}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: target is not a git repository: ${TARGET_REPO}" >&2
  exit 1
fi

if [[ ${ALLOW_DIRTY_TARGET} -eq 0 ]]; then
  if [[ -n "$(git -C "${TARGET_REPO}" status --short)" ]]; then
    echo "Error: target repo has uncommitted changes. Commit/stash first or use --allow-dirty-target." >&2
    exit 1
  fi
fi

RSYNC_ARGS=( -a --delete --exclude='.git' )
RSYNC_ARGS+=( --exclude='.env.local' --exclude='.env.test' --exclude='.deploy' )
RSYNC_ARGS+=( --exclude='scripts/sync-to-okbrain.sh' --exclude='.agent/skills/sync-brain-to-okbrain/' )
if [[ ${DRY_RUN} -eq 1 ]]; then
  RSYNC_ARGS+=( -n -v )
fi

echo "Syncing from ${BRAIN_ROOT} -> ${TARGET_REPO}"
rsync "${RSYNC_ARGS[@]}" "${BRAIN_ROOT}/" "${TARGET_REPO}/"

if [[ ${DRY_RUN} -eq 1 ]]; then
  echo "Dry-run complete. No files were changed."
  exit 0
fi

git -C "${TARGET_REPO}" add -A

if git -C "${TARGET_REPO}" diff --cached --quiet; then
  echo "No changes to commit in target repo."
  exit 0
fi

git -C "${TARGET_REPO}" commit -m "${COMMIT_MESSAGE}"

NEW_HEAD="$(git -C "${TARGET_REPO}" rev-parse --short HEAD)"
echo "Created commit ${NEW_HEAD} in ${TARGET_REPO}"
