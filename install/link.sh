#!/usr/bin/env bash
# Symlink everything under home/ into $HOME, mirroring the directory structure.
# Symlinks (not copies) mean edits to e.g. ~/.zshrc are reflected straight back
# into the repo, so the repo stays the source of truth.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/home"
BACKUP_DIR="$HOME/.machine-config-backup/$(date +%Y%m%d-%H%M%S)"

[ -d "$SRC" ] || { echo "error: $SRC not found"; exit 1; }

find "$SRC" -type f -print0 | while IFS= read -r -d '' file; do
  rel="${file#"$SRC"/}"
  dest="$HOME/$rel"
  mkdir -p "$(dirname "$dest")"

  # Already linked to the right place? skip.
  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$file" ]; then
    echo "ok    $rel (already linked)"
    continue
  fi

  # Existing real file/dir or stale symlink: back it up first.
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
    mv "$dest" "$BACKUP_DIR/$rel"
    echo "backup $rel -> $BACKUP_DIR/$rel"
  fi

  ln -s "$file" "$dest"
  echo "link  $rel -> $file"
done

echo "Dotfiles linked. (Backups, if any, in $BACKUP_DIR)"
