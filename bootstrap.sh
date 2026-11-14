#!/usr/bin/env bash
# machine-config bootstrap — set up a fresh Mac in one shot.
#   git clone https://github.com/mikeacjones/machine-config ~/Source/machine-config
#   ~/Source/machine-config/bootstrap.sh
#
# Idempotent: safe to re-run. Installs Homebrew + tools, clones zsh plugins,
# and symlinks dotfiles into $HOME.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

clone_or_update() { # <repo-url> <dest-path>
  local url="$1" dest="$2"
  if [ -d "$dest/.git" ]; then
    echo "updating $dest"; git -C "$dest" pull --ff-only --quiet
  else
    echo "cloning  $url → $dest"; git clone --depth=1 --quiet "$url" "$dest"
  fi
}

# --- Homebrew ---
step "Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "Homebrew already installed."
fi
# Load brew into this shell (Apple Silicon first, then Intel).
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

# --- Tools via Brewfile ---
step "brew bundle"
brew bundle --file "$REPO_ROOT/Brewfile"

# --- Install Ghostty (official DMG; the app self-updates after install) ---
if [ ! -d /Applications/Ghostty.app ]; then
  echo "Installing Ghostty..."
  GHOSTTY_DMG_URL=$(curl -fsSL https://ghostty.org/download | grep -oE 'https://release\.files\.ghostty\.org/[^"]+/Ghostty\.dmg' | head -1)
  GHOSTTY_TMP=$(mktemp -d)
  curl -fsSL -o "$GHOSTTY_TMP/Ghostty.dmg" "$GHOSTTY_DMG_URL"
  hdiutil attach -nobrowse -quiet -mountpoint "$GHOSTTY_TMP/mnt" "$GHOSTTY_TMP/Ghostty.dmg"
  cp -R "$GHOSTTY_TMP/mnt/Ghostty.app" /Applications/
  hdiutil detach -quiet "$GHOSTTY_TMP/mnt"
  rm -rf "$GHOSTTY_TMP"
else
  echo "Ghostty already installed."
fi

# --- Install rustup (Go and just come from the Brewfile) ---
if ! command -v rustup >/dev/null 2>&1; then
  echo "Installing rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  source ~/.zshenv
else
  echo "Updating rustup..."
  rustup update
fi
# Language server for Claude Code's rust-analyzer-lsp plugin. rustup's
# ~/.cargo/bin/rust-analyzer proxy only works once the component is installed.
PATH="$HOME/.cargo/bin:$PATH" rustup component add rust-analyzer

# --- zsh plugins (sourced by ~/.zshrc from ~/.zsh) ---
step "zsh plugins"
ZSH_DIR="$HOME/.zsh"
mkdir -p "$ZSH_DIR"
clone_or_update https://github.com/zsh-users/zsh-autosuggestions      "$ZSH_DIR/zsh-autosuggestions"
clone_or_update https://github.com/zsh-users/zsh-syntax-highlighting  "$ZSH_DIR/zsh-syntax-highlighting"

# --- Symlink dotfiles ---
step "dotfiles"
"$REPO_ROOT/install/link.sh"

# --- Default editor ---
step "default editor (Zed)"
"$REPO_ROOT/install/default-editor.sh"

# --- macOS appearance ---
step "macOS dark mode"
osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to true'

# --- Install/update claude code ---
if ! command -v claude >/dev/null 2>&1; then
  curl -fsSL https://claude.ai/install.sh | bash
else
  echo "Updating claude..."
  claude update
fi

# --- Claude Code plugins ---
# ~/.claude/settings.json is symlinked from home/.claude/settings.json, so it
# already declares which plugins are enabled. Declaring isn't enough on a new
# machine: each marketplace has to be cloned and each plugin downloaded.
step "Claude Code plugins"
export PATH="$HOME/.local/bin:$PATH" # where the installer puts `claude`
CLAUDE_SETTINGS="$REPO_ROOT/home/.claude/settings.json"
# </dev/null: `claude` would otherwise wait on, or swallow, the script's stdin.
for marketplace in $(jq -r '.extraKnownMarketplaces // {} | .[] | select(.source.source == "github") | .source.repo' "$CLAUDE_SETTINGS"); do
  claude plugin marketplace add "$marketplace" </dev/null
done
for plugin in $(jq -r '.enabledPlugins // {} | to_entries[] | select(.value == true) | .key' "$CLAUDE_SETTINGS"); do
  claude plugin install "$plugin" --scope user </dev/null
done

# --- Machine-local secrets (tokens for the claude / claude2 shell functions) ---
step ".env"
if [ ! -f "$REPO_ROOT/.env" ]; then
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
  echo "Created $REPO_ROOT/.env — fill in the values (see the comments inside)."
else
  echo ".env already exists."
fi
chmod 600 "$REPO_ROOT/.env"

step "Done"
