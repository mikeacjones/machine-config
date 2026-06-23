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

# 1. Homebrew --------------------------------------------------------------
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

# 2. Tools via Brewfile ----------------------------------------------------
step "brew bundle"
brew bundle --file "$REPO_ROOT/Brewfile"

# 2a. Install rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2b. Install alacritty via manual build
git clone https://github.com/alacritty/alacritty /tmp/alacritty
make -C /tmp/alacritty app
cp -r /tmp/alacritty/target/release/osx/Alacritty.app /Applications/

# 3. zsh plugins (sourced by ~/.zshrc from ~/.zsh) -------------------------
step "zsh plugins"
ZSH_DIR="$HOME/.zsh"
mkdir -p "$ZSH_DIR"
clone_or_update() { # <repo-url> <dest-name>
  local dest="$ZSH_DIR/$2"
  if [ -d "$dest/.git" ]; then
    echo "updating $2"; git -C "$dest" pull --ff-only --quiet
  else
    echo "cloning  $2";  git clone --depth=1 --quiet "$1" "$dest"
  fi
}
clone_or_update https://github.com/zsh-users/zsh-autosuggestions      zsh-autosuggestions
clone_or_update https://github.com/zsh-users/zsh-syntax-highlighting  zsh-syntax-highlighting

# 4. Rust toolchain (rustup) ----------------------------------------------
step "Rust (rustup)"
if ! command -v rustup >/dev/null 2>&1 && [ ! -x "$HOME/.cargo/bin/rustup" ]; then
  echo "Installing rustup..."
  # --no-modify-path: ~/.cargo/bin is added to PATH by our .zshrc instead.
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
else
  echo "rustup already installed."
fi
# Ensure a stable toolchain is present and up to date.
"$HOME/.cargo/bin/rustup" default stable

# 5. Symlink dotfiles ------------------------------------------------------
step "dotfiles"
"$REPO_ROOT/install/link.sh"

# 6. Default editor --------------------------------------------------------
step "default editor (Zed)"
"$REPO_ROOT/install/default-editor.sh"

step "Done"
echo "Open a new Alacritty window (you'll land in tmux), or run: exec zsh"
