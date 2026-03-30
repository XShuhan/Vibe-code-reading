#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_step() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

find_vscode_cli() {
  local candidate

  for candidate in code code.cmd code-insiders code-insiders.cmd; do
    if command -v "$candidate" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  return 1
}

log_step "Resolving repository paths"

ROOT_DIR="$SCRIPT_DIR"
EXTENSION_DIR="$ROOT_DIR/apps/extension"

if cd "$SCRIPT_DIR" && pwd -W >/dev/null 2>&1; then
  ROOT_DIR="$(cd "$SCRIPT_DIR" && pwd -W)"
  EXTENSION_DIR="${ROOT_DIR}\\apps\\extension"
fi

cd "$SCRIPT_DIR"

[ -d "apps/extension" ] || fail "Could not find the extension directory at apps/extension."

log_step "Checking pnpm installation"
command -v pnpm >/dev/null 2>&1 || fail "pnpm is not installed. Install pnpm first, then rerun ./start.sh."

log_step "Installing workspace dependencies"
pnpm install

log_step "Building workspace"
pnpm build

log_step "Checking VS Code CLI availability"
VSCODE_CLI="$(find_vscode_cli)" || fail "VS Code CLI was not found. Install the 'code' command in VS Code first."

log_step "Opening the repository in VS Code with the extension development host"
"$VSCODE_CLI" "$ROOT_DIR" --extensionDevelopmentPath="$EXTENSION_DIR"

log_step "Done"
printf 'VS Code should now open with an Extension Development Host.\n'
