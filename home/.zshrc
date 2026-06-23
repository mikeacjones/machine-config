# ~/.zshrc — bare setup (no oh-my-zsh)

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"

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
        echo -n "$path_display on ${branch_color}$branch%f"
        [[ -n "$status_flags" ]] && echo -n " %F{red}[$status_flags]%f"
    else
        # Not in a git repo, just show directory name
        echo -n "%F{cyan}%1~%f"
    fi
}

# Set the prompt
PROMPT='$(git_prompt_info) %F{magenta}❯%f '
