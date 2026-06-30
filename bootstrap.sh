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

# -- Install go ---
GO_VERSION=$(curl -s "https://go.dev/dl/?mode=json" | jq -r '.[0].version')
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
curl -OL "https://go.dev/dl/${GO_VERSION}.darwin-${ARCH}.tar.gz"
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf "${GO_VERSION}.darwin-${ARCH}.tar.gz"
rm "${GO_VERSION}.darwin-${ARCH}.tar.gz"

# --- Install rustup ---
if ! command -v rustup >/dev/null 2>&1; then
  echo "Installing rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  source ~/.zshenv
else
  echo "Updating rustup..."
  rustup update
fi

# -- Install just ---
if ! command -v just > /dev/null 2>&1; then
  echo "Installing just..."
  cargo install just
else
  echo "Updating just..."
  cargo install just --force
fi

#  --- Install alacritty via manual build ---
step "Alacritty"
clone_or_update https://github.com/alacritty/alacritty /tmp/alacritty
make -C /tmp/alacritty app
cp -r /tmp/alacritty/target/release/osx/Alacritty.app /Applications/

# --- Set up alacritty themes ---
mkdir -p ~/.config/alacritty
clone_or_update https://github.com/alacritty/alacritty-theme ~/.config/alacritty/themes

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

# --- Install/update claude code ---
if ! command -v claude >/dev/null 2>&1; then
  curl -fsSL https://claude.ai/install.sh | bash
else
  echo "Updating claude..."
  claude update
fi

step "Done"
