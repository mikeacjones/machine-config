# Brewfile — `brew bundle` installs everything listed here.
# Run via ./bootstrap.sh, or directly: brew bundle --file Brewfile

# -- Taps ---
tap "opalsecurity/brew", trusted: true

# --- CLI Tools ---
brew "tmux"        # terminal multiplexer
brew "uv"          # python package/proj manager
brew "gh"          # github cli
brew "ripgrep"     # fast grep (rg)
brew "hyperfine"   # benchmarking
brew "awscli"
brew "duti"        # set default apps by file type (used to make Zed the default editor)
brew "git"
brew "node"
brew "make"
brew "zsh"
brew "helm"
brew "opentofu"
brew "minikube"
brew "go"
brew "just"        # command runner
brew "jq"          # used by bootstrap.sh / update.sh to read Claude settings
brew "terminal-notifier" # macOS notifications for Herdr alerts (herdr/mods/toast-native)

# --- Language servers (used by Claude Code's LSP plugins; rust-analyzer comes from rustup) ---
brew "gopls"
brew "pyright"
brew "derailed/k9s/k9s", trusted: true

# --- Temporal Specific CLIs ---
brew "opalsecurity/brew/opal-security", trusted: true

# --- GUI Apps (casks) ---
cask "zed"
cask "docker-desktop"
cask "rectangle"
cask "shottr"

# --- Fonts ---
cask "font-iosevka"
cask "font-noto-sans-mono" # Herdr font (temporal.io's monospace)
