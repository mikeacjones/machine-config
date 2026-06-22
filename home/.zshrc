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

# --- prompt (robbyrussell, reproduced with native vcs_info) ---
setopt prompt_subst
autoload -Uz vcs_info
zstyle ':vcs_info:*' enable git
zstyle ':vcs_info:git:*' formats       ' %F{blue}git:(%F{red}%b%F{blue})%m%f'
zstyle ':vcs_info:git:*' actionformats ' %F{blue}git:(%F{red}%b%F{blue})%m%f %F{yellow}%a%f'
zstyle ':vcs_info:git*+set-message:*' hooks git-dirty
+vi-git-dirty() {
	if [[ -n $(git status --porcelain --ignore-submodules=dirty 2>/dev/null) ]]; then
		hook_com[misc]=' %F{yellow}✗'
	fi
}
precmd() { vcs_info }
PROMPT='%(?:%B%F{green}➜%b%f :%B%F{red}➜%b%f )%F{cyan}%c%f${vcs_info_msg_0_} '

# --- plugins ---
ZSH_AUTOSUGGEST_STRATEGY=(history completion)
source "$HOME/.zsh/zsh-autosuggestions/zsh-autosuggestions.zsh"
# syntax-highlighting must be sourced last
source "$HOME/.zsh/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"

# --- aliases ---
alias access-sa-demo="/Users/mjones/.scripts/eks/access-sa-demo-eks-cluster.sh"
alias la="ls -la"

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
