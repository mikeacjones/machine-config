#!/usr/bin/env bash
# machine-config update — bring everything bootstrap.sh installed up to date.
#   ~/Source/machine-config/update.sh
#
# Idempotent: only what is actually out of date gets touched, so a re-run with
# nothing to do is a fast no-op. Most tools (Go, just, tree-sitter-cli, ...) come
# from the Brewfile and are covered by the Homebrew section.
# Upgrade-only: anything bootstrap.sh hasn't installed yet is reported and
# skipped. Sections are independent — a failure in one is reported at the end
# instead of aborting the rest.
#
# Not handled here because they update themselves: Ghostty, and the Brewfile's
# self-updating apps (Zed, Docker Desktop, Rectangle, Shottr).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BREWFILE="$REPO_ROOT/Brewfile"

# Same locations ~/.zshrc puts on PATH, in case this runs outside a login shell.
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
skip() { echo "skip: $1 — run bootstrap.sh to install"; }
have() { command -v "$1" >/dev/null 2>&1; }

FAILED=()
section() { # <title> <function>
  step "$1"
  # A bare subshell (not under `if`/`||`) so `set -e` is honoured inside it.
  ( set -e; "$2" )
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '\033[1;31mfailed: %s (exit %s)\033[0m\n' "$1" "$rc"
    FAILED+=("$1")
  fi
}

# --- Homebrew + everything in the Brewfile ---
update_homebrew() {
  have brew || { skip "Homebrew not found"; return 0; }
  brew update

  local kind names installed outdated
  for kind in formula cask; do
    names=$(brew bundle list --file "$BREWFILE" "--$kind")
    [ -n "$names" ] || continue
    # `brew list --versions` prints only the entries that are installed (resolving
    # aliases such as nvim → neovim) and exits non-zero if any are missing.
    # shellcheck disable=SC2086  # word-splitting the name lists is intended
    installed=$(brew list --versions "--$kind" $names 2>/dev/null | awk '{print $1}') || true
    [ -n "$installed" ] || continue
    # shellcheck disable=SC2086
    outdated=$(brew outdated --quiet "--$kind" $installed)
    if [ -n "$outdated" ]; then
      # shellcheck disable=SC2086
      brew upgrade "--$kind" $outdated
    else
      echo "Brewfile $kind entries are up to date."
    fi
  done

  # Point out Brewfile entries that aren't installed via Homebrew at all.
  brew bundle check --file "$BREWFILE" --no-upgrade --verbose || true
}

# --- Rust toolchains (and rustup itself) ---
update_rust() {
  have rustup || { skip "rustup not found"; return 0; }
  rustup update
}

# --- zsh plugins (git clones under ~/.zsh) ---
update_zsh_plugins() {
  local dir found=0
  for dir in "$HOME"/.zsh/*/; do
    [ -d "${dir}.git" ] || continue
    found=1
    echo "updating ${dir%/}"
    git -C "$dir" pull --ff-only --quiet
  done
  [ "$found" -eq 1 ] || skip "no plugins found in ~/.zsh"
}

# --- Claude Code ---
update_claude() {
  have claude || { skip "claude not found"; return 0; }
  claude update
}

section "Homebrew"     update_homebrew
section "Rust"         update_rust
section "zsh plugins"  update_zsh_plugins
section "Claude Code"  update_claude

if [ "${#FAILED[@]}" -gt 0 ]; then
  step "Done, with failures"
  printf '  - %s\n' "${FAILED[@]}"
  exit 1
fi
step "Done"
