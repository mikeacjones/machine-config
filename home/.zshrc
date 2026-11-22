# ~/.zshrc — bare setup (no oh-my-zsh)

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:/opt/homebrew/opt/mysql-client/bin:$PATH"
export GPG_TTY=$(tty)

# --- terminal type ---
# Ghostty sets TERM=xterm-ghostty, and ssh passes it to hosts that may have no
# terminfo for it. zsh then can't move the cursor, so every line redraw is
# appended ("eexitexexxi..."). Fall back to a type every host knows.
infocmp "$TERM" &>/dev/null || export TERM=xterm-256color

# --- ssh agent ---
# macOS starts its ssh-agent empty at every login. Load the keys whose passphrases are in
# the Keychain when it holds none, so git's SSH commit signing (ssh-keygen -Y sign) finds
# the key in the agent instead of stopping to ask for a passphrase. Apple's ssh-add only.
/usr/bin/ssh-add -l >/dev/null 2>&1 || /usr/bin/ssh-add --apple-load-keychain >/dev/null 2>&1

# --- history ---
HISTFILE="$HOME/.zsh_history"
HISTSIZE=50000
SAVEHIST=50000
setopt extended_history hist_expire_dups_first hist_ignore_dups \
       hist_ignore_space hist_verify inc_append_history share_history

# --- completion (cached: full init + security check at most once a day) ---
autoload -Uz compinit
ZCOMPDUMP="$HOME/.zcompdump"
if [[ -n $ZCOMPDUMP(#qN.mh+24) ]]; then
	compinit -d "$ZCOMPDUMP"
else
	compinit -C -d "$ZCOMPDUMP"
fi

if [[ ! -f ~/.zcompdump.zwc || ~/.zcompdump -nt ~/.zcompdump.zwc ]]; then
  zcompile ~/.zcompdump
fi
# case-insensitive matching + a completion menu
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'
zstyle ':completion:*' menu select

# --- plugins ---
ZSH_AUTOSUGGEST_STRATEGY=(history completion)
source "$HOME/.zsh/zsh-autosuggestions/zsh-autosuggestions.zsh"
# syntax-highlighting must be sourced last
source "$HOME/.zsh/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"

# --- aliases ---
alias access-sa-demo="$HOME/.scripts/eks/access-sa-demo-eks-cluster.sh"
# Per-cluster kubectl/k9s wrappers (contexts created by access-sa-demo).
# Plain kubectl/k9s follow the current-context that access-sa-demo sets.
alias bluekctl="kubectl --context blue"
alias greenkctl="kubectl --context green"
alias bluek9s="k9s --context blue"
alias greenk9s="k9s --context green"
alias la="ls -la"
alias minikube-temp="$HOME/.scripts/minikube/temp-kube.sh"

# --- keybindings ---
_autosuggest_or_complete() {
	if [[ -n "$POSTDISPLAY" ]]; then
		zle autosuggest-accept
	else
		zle expand-or-complete
	fi
}
zle -N _autosuggest_or_complete
bindkey '\t' _autosuggest_or_complete

# -- title rewrite ---
precmd() {
  # %1d shows only the current folder name. Use %~ to show the full relative path.
  print -Pn "\e]0;%1d\a"
}

# -- terminal mode reset ---
# A remote TUI (Claude Code, vim, tmux) turns on mouse and focus reporting.
# If ssh dies before it can turn them off, mouse motion shows up as typed
# garbage like "35;61;14M". Turn those modes off before every prompt.
_reset_term_modes() {
  printf '\e[?1000l\e[?1002l\e[?1003l\e[?1006l\e[?1004l'
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _reset_term_modes

# -- prompt --

# Enable prompt substitution
setopt PROMPT_SUBST

# Git prompt function
git_prompt_info() {
    # Check if we're in a git repo
    if git rev-parse --is-inside-work-tree &>/dev/null; then
        # Get the branch name
        local branch=$(git symbolic-ref --short HEAD 2>/dev/null || git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD 2>/dev/null)

        # Get repo root and calculate relative path
        local repo_root=$(git rev-parse --show-toplevel 2>/dev/null)
        local repo_name=$(basename "$repo_root")
        local rel_path=$(git rev-parse --show-prefix 2>/dev/null)
        rel_path=${rel_path%/}  # Remove trailing slash

        # Build the path display
        local path_display
        if [[ -z "$rel_path" ]]; then
            path_display="%F{cyan}$repo_name%f"
        else
            path_display="%F{cyan}$repo_name%f/%F{blue}$rel_path%f"
        fi

        # Check git status
        local status_flags=""
        local git_status=$(git status --porcelain 2>/dev/null)

        # Check for various conditions
        [[ -n $(echo "$git_status" | grep '^??') ]] && status_flags+="?"  # Untracked files
        [[ -n $(echo "$git_status" | grep '^ D') ]] && status_flags+="✗"  # Deleted files
        [[ -n $(echo "$git_status" | grep '^ M') ]] && status_flags+="●"  # Modified files
        [[ -n $(echo "$git_status" | grep '^M') ]] && status_flags+="●"   # Modified staged
        [[ -n $(echo "$git_status" | grep '^A') ]] && status_flags+="+"   # Added files

        # Check for upstream differences
        local upstream_status=$(git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null)
        if [[ -n "$upstream_status" ]]; then
            local behind=$(echo "$upstream_status" | awk '{print $2}')
            local ahead=$(echo "$upstream_status" | awk '{print $1}')
            [[ "$ahead" -gt 0 ]] && status_flags+="↑"
            [[ "$behind" -gt 0 ]] && status_flags+="↓"
        fi

        # Color the branch based on status
        local branch_color="%F{green}"
        [[ -n "$status_flags" ]] && branch_color="%F{yellow}"

        # Output the git info
        echo -n "$path_display ${branch_color}$branch%f"
        [[ -n "$status_flags" ]] && echo -n " %F{red}[$status_flags]%f"
    else
        # Not in a git repo, just show directory name
        if [[ "${PWD:l}" == "${HOME:l}"* ]]; then
            echo -n "%F{cyan}%~%f"
        else
            echo -n "%F{cyan}%d%f"
        fi
    fi
}

# Session marker: shows [SSH] when this shell was reached over SSH, so a
# remote prompt is never mistaken for a local one.
session_info() {
    [[ -n "$SSH_CLIENT" || -n "$SSH_TTY" ]] && echo -n "%F{yellow}[SSH]%f "
}

# Set the prompt
PROMPT='$(session_info)$(git_prompt_info) %F{magenta}❯%f '

# -- Claude Code accounts --
# `claude`, `claude2` and `claude3` each sign in with the normal /login, which
# keeps that account's credentials in the macOS Keychain. Claude Code stores the
# login per config directory, so claude2/claude3 each get a small directory under
# ~/.claude-accounts/ that holds only the login and per-account state. Everything
# shared (memory, skills, settings, plugins, hooks, rules, history) is a symlink
# back to ~/.claude, so there is still one place to edit.
CLAUDE_ACCOUNTS_DIR="$HOME/.claude-accounts"
CLAUDE_SHARED_DIRS=(projects skills plugins hooks rules agents commands output-styles plans todos file-history)
CLAUDE_SHARED_FILES=(CLAUDE.md settings.json settings.local.json keybindings.json history.jsonl)

_claude_account_dir() { # <name> — create/repair ~/.claude-accounts/<name>, print its path
  local dir="$CLAUDE_ACCOUNTS_DIR/$1" item
  mkdir -p "$dir"
  for item in $CLAUDE_SHARED_DIRS; do
    mkdir -p "$HOME/.claude/$item"
    [[ -e "$dir/$item" || -L "$dir/$item" ]] || ln -s "$HOME/.claude/$item" "$dir/$item"
  done
  for item in $CLAUDE_SHARED_FILES; do
    [[ -e "$HOME/.claude/$item" ]] || continue
    [[ -e "$dir/$item" || -L "$dir/$item" ]] || ln -s "$HOME/.claude/$item" "$dir/$item"
  done
  for item in $CLAUDE_SHARED_DIRS $CLAUDE_SHARED_FILES; do
    [[ -e "$dir/$item" && ! -L "$dir/$item" ]] && print -u2 "claude: $dir/$item is a real file, not shared with ~/.claude"
  done
  print -rn -- "$dir"
}

# Primary account: the default ~/.claude and its Keychain login.
(( $+functions[claude] )) && unfunction claude

claude2() { CLAUDE_CONFIG_DIR="$(_claude_account_dir claude2)" command claude "$@" }
claude3() { CLAUDE_CONFIG_DIR="$(_claude_account_dir claude3)" command claude "$@" }
