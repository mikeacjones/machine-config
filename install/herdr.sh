#!/usr/bin/env bash
# Herdr: the desktop app, the `herdr` CLI it runs on, and our Herdr setup
# (layout, Modus themes, mods, settings) kept in herdr/.
#
#   install/herdr.sh install [--force]  install Herdr if missing, copy herdr/ into
#                                       ~/.config/herdr-app, make our layout the default.
#                                       Files that differ locally are listed, not replaced,
#                                       unless --force (which backs them up first)
#   install/herdr.sh capture [path...]  copy the tracked files back from ~/.config/herdr-app
#                                       into herdr/ (then commit); a path (mods/foo,
#                                       themes/x.json) starts tracking something new
#
# Copies, not symlinks: Herdr's live reload doesn't follow symlinks. An edit made
# through a symlinked file or folder never reloads, so the real files have to live
# in ~/.config/herdr-app. Edit them there, then `capture` to bring them into the repo.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/herdr"
DEST="$HOME/.config/herdr-app"
LAYOUT="beads" # layouts/<name>.json shown by default
APP_DMG_URL="https://releases.herdr.dev/app/Herdr.dmg"
export PATH="$HOME/.local/bin:$PATH" # where the herdr installer and the app put their commands

# Files Herdr writes into every mod folder (type definitions, editor config) and
# other noise: not ours to track or to copy over.
EXCLUDES=(--exclude 'gpui-kit.d.ts' --exclude 'herdr.d.ts' --exclude 'jsconfig.json'
  --exclude '*.error' --exclude '.DS_Store' --exclude '__pycache__' --exclude '.gitignore')

install_cli() {
  if command -v herdr >/dev/null 2>&1; then
    echo "herdr CLI already installed ($(herdr --version))."
  else
    echo "Installing the herdr CLI..."
    # Official installer: checks the download's SHA-256, puts herdr in ~/.local/bin.
    # It updates itself afterwards with `herdr update` (see update.sh).
    curl -fsSL https://herdr.dev/install.sh | sh
  fi
}

install_app() {
  if [ -d /Applications/Herdr.app ]; then
    echo "Herdr.app already installed."
    return
  fi
  # Official DMG; the app downloads its own updates after this.
  echo "Installing Herdr.app..."
  local tmp
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/Herdr.dmg" "$APP_DMG_URL"
  hdiutil attach -nobrowse -quiet -mountpoint "$tmp/mnt" "$tmp/Herdr.dmg"
  cp -R "$tmp/mnt/Herdr.app" /Applications/
  hdiutil detach -quiet "$tmp/mnt"
  rm -rf "$tmp"
}

apply_config() { # [--force]
  mkdir -p "$DEST"
  # No --delete anywhere: Herdr's own files (shipped layouts, state, sockets) stay as they are.
  if [ "${1:-}" = "--force" ]; then
    # The repo's version wins; a local file it replaces is kept in the backup folder first.
    local backup="$HOME/.machine-config-backup/$(date +%Y%m%d-%H%M%S)/.config/herdr-app"
    rsync -a --checksum --itemize-changes --backup --backup-dir="$backup" "${EXCLUDES[@]}" "$SRC/" "$DEST/"
    [ -d "$backup" ] && echo "Replaced files backed up to $backup"
    return 0
  fi
  # Default: only add what's missing. A file that differs here may be a newer local edit
  # not captured yet, so it's listed, not replaced.
  rsync -a --ignore-existing --itemize-changes "${EXCLUDES[@]}" "$SRC/" "$DEST/"
  local differ
  differ=$(rsync -a --checksum --dry-run --out-format='%n' "${EXCLUDES[@]}" "$SRC/" "$DEST/" | grep -v '/$' || true)
  if [ -n "$differ" ]; then
    echo "These differ between herdr/ and $DEST (left as they are):"
    printf '  %s\n' $differ
    echo "Keep this machine's: install/herdr.sh capture   Take the repo's: install/herdr.sh install --force"
  fi
  return 0
}

default_layout() {
  # The shown layout is shared("layout"), saved in shared.json. A running app keeps
  # that file in memory and rewrites it, so ask the app itself when it's running.
  if pgrep -xq Herdr && command -v herdr-app >/dev/null 2>&1; then
    herdr-app do layout.switch "{\"name\":\"$LAYOUT\"}" >/dev/null && echo "Showing layout '$LAYOUT'."
  elif [ -f "$DEST/shared.json" ]; then
    local tmp
    tmp=$(mktemp)
    jq --arg l "$LAYOUT" '.layout = $l' "$DEST/shared.json" >"$tmp" && mv "$tmp" "$DEST/shared.json"
    echo "Layout '$LAYOUT' will show on Herdr's next start."
  else
    printf '{"layout":"%s"}\n' "$LAYOUT" >"$DEST/shared.json"
    echo "Layout '$LAYOUT' will show on Herdr's first start."
  fi
}

capture() {
  local p
  for p in "$@"; do # start tracking new paths
    [ -e "$DEST/$p" ] || { echo "error: $DEST/$p not found"; exit 1; }
    mkdir -p "$SRC/$(dirname "$p")"
    if [ -d "$DEST/$p" ]; then mkdir -p "$SRC/$p"; else cp "$DEST/$p" "$SRC/$p"; fi
  done
  # Everything herdr/ tracks: whole mod folders (files removed there are removed
  # here too), and single files everywhere else.
  local mod file
  for mod in "$SRC"/mods/*/; do
    mod=$(basename "$mod")
    if [ -d "$DEST/mods/$mod" ]; then
      rsync -a --delete --itemize-changes "${EXCLUDES[@]}" "$DEST/mods/$mod/" "$SRC/mods/$mod/"
    else
      echo "warning: mods/$mod is tracked but not in $DEST"
    fi
  done
  while IFS= read -r file; do
    file=${file#"$SRC"/}
    if [ -f "$DEST/$file" ]; then
      cmp -s "$DEST/$file" "$SRC/$file" || { cp "$DEST/$file" "$SRC/$file"; echo "updated $file"; }
    else
      echo "warning: $file is tracked but not in $DEST"
    fi
  done < <(find "$SRC" -path "$SRC/mods" -prune -o -type f ! -name .gitignore ! -name .DS_Store -print)
  echo "Captured into $SRC. Review with: git -C \"$REPO_ROOT\" diff --stat -- herdr"
}

case "${1:-}" in
  install)
    install_cli
    install_app
    apply_config "${2:-}"
    default_layout
    ;;
  capture)
    shift
    capture "$@"
    ;;
  *)
    echo "usage: $0 install [--force] | capture [path...]" >&2
    exit 2
    ;;
esac
