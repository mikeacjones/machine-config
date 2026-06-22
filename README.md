# machine-config

Dotfiles + bootstrap for rapidly setting up a fresh Mac.

## Usage

```sh
git clone https://github.com/mikeacjones/machine-config ~/Source/machine-config
~/Source/machine-config/bootstrap.sh
```

`bootstrap.sh` is idempotent — safe to re-run any time to pick up new tools/configs.

## What it does

1. **Homebrew** — installs it if missing.
2. **Tools** — `brew bundle` from [`Brewfile`](./Brewfile): tmux, uv, gh, ripgrep, hyperfine, go, plus Alacritty, Zed, and the Iosevka font.
3. **zsh plugins** — clones `zsh-autosuggestions` and `zsh-syntax-highlighting` into `~/.zsh/` (sourced by `.zshrc`).
4. **Rust** — installs `rustup` via the official installer (`--no-modify-path`; `~/.cargo/bin` is on PATH via `.zshrc`) and sets the `stable` toolchain.
5. **Dotfiles** — symlinks everything under [`home/`](./home) into `$HOME` (mirroring the structure), backing up any existing files to `~/.machine-config-backup/<timestamp>/`.

## Layout

```
home/                         # mirrors $HOME — anything here gets symlinked in
  .zshrc
  .tmux.conf
  .config/alacritty/alacritty.toml
Brewfile                      # `brew bundle` tool list
bootstrap.sh                  # main entrypoint
install/link.sh               # symlinks home/ -> $HOME
```

## Adding a new config

Drop the file under `home/` at the path it should live at in `$HOME`, then re-run
`./bootstrap.sh` (or just `install/link.sh`). Because configs are **symlinked**,
editing e.g. `~/.zshrc` later edits the repo copy directly — commit and push to sync.

## Notes

- Terminal: Alacritty launches straight into tmux (`new-session -A -s main`); mouse
  click-to-focus is on in `.tmux.conf`.
- `alacritty.toml` hardcodes `/opt/homebrew/bin/tmux` (Apple Silicon brew prefix).
  On an Intel Mac change it to `/usr/local/bin/tmux`.
- `.zshrc` has a personal `access-sa-demo` alias pointing at `~/.scripts/...`; that
  script isn't in this repo, so the alias just no-ops until you add it.
- Font: `font-iosevka` (cask) provides the "Iosevka Term" family used by Alacritty
  and Zed.
- Zed: `settings.json` is symlinked in, and its `auto_install_extensions` block makes
  Zed install csharp, dockerfile, git-firefly, html, macos-classic, mermaid,
  terraform, and toml on first launch. (Zed may rewrite this file via atomic save and
  break the symlink — if extensions/settings drift, just re-run `install/link.sh`.)
