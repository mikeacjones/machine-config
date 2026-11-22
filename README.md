# machine-config

Dotfiles + bootstrap for rapidly setting up a fresh Mac.

## Usage

```sh
git clone https://github.com/mikeacjones/machine-config ~/Source/machine-config
~/Source/machine-config/bootstrap.sh
```

`bootstrap.sh` is idempotent — safe to re-run any time to pick up new tools/configs.

## Updating

```sh
~/Source/machine-config/update.sh
```

`update.sh` upgrades what `bootstrap.sh` installed — Homebrew and the Brewfile's
packages, Rust toolchains, zsh plugins, Claude Code and its plugins — and only touches
what is actually out of date. It never installs anything new or changes settings; use
`bootstrap.sh` for that.

## What it does

1. **Homebrew** — installs it if missing.
2. **Tools** — `brew bundle` from [`Brewfile`](./Brewfile): tmux, uv, gh, ripgrep, hyperfine, go, just, plus Zed and the Iosevka font. Ghostty is installed from its official DMG on ghostty.org.
3. **zsh plugins** — clones `zsh-autosuggestions` and `zsh-syntax-highlighting` into `~/.zsh/` (sourced by `.zshrc`).
4. **Rust** — installs `rustup` via the official installer (`--no-modify-path`; `~/.cargo/bin` is on PATH via `.zshrc`) and sets the `stable` toolchain, then adds the `rust-analyzer` component.
5. **Dotfiles** — symlinks everything under [`home/`](./home) into `$HOME` (mirroring the structure), backing up any existing files to `~/.machine-config-backup/<timestamp>/`.
6. **Default editor** — [`install/default-editor.sh`](./install/default-editor.sh) uses `duti` to make Zed the default app for text/source-code file types.
7. **Claude Code** — installs it, then adds the plugin marketplaces and installs the plugins that [`home/.claude/settings.json`](./home/.claude/settings.json) enables (see [Claude Code](#claude-code)).
8. **`.env`** — copies [`.env.example`](./.env.example) to `.env` (gitignored, mode 600) if it doesn't exist yet.

## Claude Code

Global Claude Code config lives under [`home/.claude/`](./home/.claude) and is symlinked
into `~/.claude/` like any other dotfile. The rest of `~/.claude/` (history, sessions,
plugin caches, account-synced skills) is machine state and stays out of the repo.

- `settings.json` — model, theme, attribution, hooks, and `enabledPlugins`. Claude Code
  writes through the symlink, so changing a setting or enabling a plugin on one machine
  shows up here as a diff to commit.
- `hooks/no-claude-attribution.py` — `PreToolUse` hook that strips Claude attribution
  from commits, PRs, issues and comments before they are published.
- `rules/*.md` — instructions loaded in every project. `commit-pr-style.md` sets the
  commit message and pull request format.
- **Plugins / language servers** — the Go, Rust and Python LSP plugins (`gopls-lsp`,
  `rust-analyzer-lsp`, `pyright-lsp`) are enabled in `settings.json`. The servers they
  start come from the Brewfile (`gopls`, `pyright`) and from rustup
  (`rustup component add rust-analyzer`). To add a plugin, install it with
  `claude plugin install <name>@<marketplace>` and commit the `settings.json` change;
  `bootstrap.sh` installs whatever that file enables.
- **Personal skills** — none yet. Put one at `home/.claude/skills/<name>/SKILL.md`.

### `claude`, `claude2` and `claude3`

Each command signs in with the normal interactive login (`/login`), which keeps that
account's credentials in the macOS Keychain. Claude Code stores the login per config
directory, so `.zshrc` gives `claude2` and `claude3` their own `CLAUDE_CONFIG_DIR` under
`~/.claude-accounts/<name>/`:

- **Per account:** the login, `.claude.json` (account, onboarding, user-scope MCP
  servers), sessions and caches.
- **Shared, symlinked to `~/.claude`:** `projects/` (transcripts and auto memory),
  `skills/`, `plugins/`, `hooks/`, `rules/`, `agents/`, `commands/`, `plans/`,
  `CLAUDE.md`, `settings*.json` and `history.jsonl`. Edit them in `~/.claude`.

The functions create and repair those links on every run. First use per account:

```sh
claude2    # then /login with the second account
claude3    # then /login with the third account
```

An MCP server added with `claude mcp add --scope user` goes into that account's
`.claude.json` only. Add it to each account, or use project-scope `.mcp.json`.

## Layout

```
home/                         # mirrors $HOME — anything here gets symlinked in
  .zshrc
  .tmux.conf
  .config/ghostty/config.ghostty
  .warp/keybindings.yaml        # Warp: Tab accepts autosuggestions
  .claude/                    # global Claude Code settings, hooks and rules
Brewfile                      # `brew bundle` tool list
bootstrap.sh                  # main entrypoint
update.sh                     # upgrade what bootstrap installed
.env.example                  # template for machine-local secrets (.env)
install/link.sh               # symlinks home/ -> $HOME
```

## Adding a new config

Drop the file under `home/` at the path it should live at in `$HOME`, then re-run
`./bootstrap.sh` (or just `install/link.sh`). Because configs are **symlinked**,
editing e.g. `~/.zshrc` later edits the repo copy directly — commit and push to sync.

## Notes

- Terminal: Ghostty (`config.ghostty`, symlinked to `~/.config/ghostty/`). Ghostty also
  reads `~/Library/Application Support/com.mitchellh.ghostty/config.ghostty`; keep only
  one so the two don't layer.
- Warp: only `keybindings.yaml` is in the repo (Tab accepts the inline autosuggestion;
  completions are on Ctrl-Space). Warp reads it only at launch, so restart Warp after
  editing. `~/.warp/settings.toml` stays machine-local.
- `.zshrc` has a personal `access-sa-demo` alias pointing at `~/.scripts/...`; that
  script isn't in this repo, so the alias just no-ops until you add it.
- Font: `font-iosevka` (cask) provides the "Iosevka Term" family used by Zed.
- Zed: `settings.json` is symlinked in, and its `auto_install_extensions` block makes
  Zed install csharp, dockerfile, git-firefly, html, macos-classic, mermaid,
  terraform, and toml on first launch. (Zed may rewrite this file via atomic save and
  break the symlink — if extensions/settings drift, just re-run `install/link.sh`.)
