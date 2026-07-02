# Neovim Cheat Sheet

Leader = `Space`. Personal config lives in `home/.config/nvim/lua/mjones`.

## LSP
| Key | Action |
|-----|--------|
| `<C-y>` | Accept completion suggestion (in cmp menu) |
| `<C-n>` / `<C-p>` | Next / prev completion item |
| `<C-Space>` | Trigger completion manually |
| `gd` | Go to definition |
| `<C-o>` / `<C-i>` | Jump back / forward (jumplist) |
| `K` | Hover docs |
| `<leader>vd` | Show diagnostic (error) message in a float |
| `[d` / `]d` | Next / prev diagnostic |
| `<leader>vca` | Code action |
| `<leader>vrr` | Find references |
| `<leader>vrn` | Rename symbol |
| `<leader>vws` | Workspace symbol search |
| `<C-h>` (insert) | Signature help |

## Formatting (conform.nvim)
- Formats **on save** automatically (gofmt, stylua, prettier, etc.; falls back to LSP).
- `<leader>f` — manually format the whole file.

## Telescope
| Key | Action |
|-----|--------|
| `<leader>pf` | Find files by name |
| `<C-p>` | Find git-tracked files |
| `<leader>ps` | Grep: search a typed word across all files |
| `<leader>pws` | Grep word under cursor |
| `<leader>pWs` | Grep WORD under cursor (incl. punctuation) |
| `<leader>vh` | Help tags |

## Git (vim-fugitive)
| Key / Cmd | Action |
|-----------|--------|
| `<leader>gs` | Open git status window |
| `:Git show HEAD` | Show most recent commit (message + diff) |
| `:Git log -1` | Most recent commit message |
| `gq` | Close a fugitive panel |
| `g?` | Fugitive help / keybindings |
| `<leader>p` | `git push` (in status window) |
| `<leader>P` | `git pull --rebase` (in status window) |
| `gu` / `gh` | Take ours (`//2`) / theirs (`//3`) in a merge conflict |

## Editing — verbs + text objects
Grammar: **verb** (`c`=change, `d`=delete, `y`=yank) + **modifier** (`i`=inner, `a`=around) + **object** (`w`=word, `"` `(` `{` `[` `t`=tag).

| Command | Effect |
|---------|--------|
| `ciw` | Change inner word (then `.` to repeat on next) |
| `ci"` / `ci(` / `ci{` | Change inside quotes / parens / braces |
| `ci<` | Change inside `<...>` (one HTML tag only) |
| `cit` / `cat` | Change text inside a tag / the whole tag element |
| `cgn` | Change next search match, then `.` to repeat / `n` to skip |

## vim-surround (installed: `tpope/vim-surround`)
| Command | Effect |
|---------|--------|
| `cst<label>` | Change surrounding tag (both sides at once) |
| `dst` | Delete/unwrap surrounding tag |
| `cs"'` | Change surrounding `"` → `'` |
| `ds(` | Delete surrounding parens |
| `ysiw"` | Wrap word in quotes |
| `S)` (visual) | Surround selection |

## Movement / insertion tricks
| Command | Effect |
|---------|--------|
| `$i` | Jump to end of line, insert **before** last char (e.g. inside a trailing `)`) |
| `f)i` / `t)a` | Insert just before the next `)` |
| `%` | Jump to matching bracket |
| `A` / `i` / `a` | Append at line end / insert before cursor / append after cursor |

## Replace a word on specific lines
- `V` + `j` to select lines, then `:s/old/new/g` (scoped to selection).
- `:s/old/new/g` on one line replaces all occurrences on that line.

## Shell / misc
| Command | Action |
|---------|--------|
| `:!go get ...` | Run a one-off shell command (uses cwd) |
| `:term` | Open interactive terminal (`<C-\><C-n>` to exit insert) |
| `:r !cmd` | Read command output into buffer |
| `:pwd` | Show current working directory |
| `:source %` | Source current file (plugin config changes need a full restart) |
| `:restart` | Restart Neovim |
