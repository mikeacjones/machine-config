#!/usr/bin/env bash
# Make Zed the default app for text-based and source-code files (macOS Launch Services).
# Uses `duti`, which binds a bundle id to a UTI. We set the umbrella text/code UTIs
# (most file types inherit from these) plus common language-specific UTIs.
set -uo pipefail

ZED_ID="dev.zed.Zed"

command -v duti >/dev/null 2>&1 || { echo "duti not found (brew install duti) — skipping"; exit 0; }

# Umbrella types: nearly all text/code conforms to these, so Launch Services falls
# back to them for types without a more specific binding.
UMBRELLA=(
  public.text public.plain-text public.utf8-plain-text public.utf16-plain-text
  public.source-code public.script public.shell-script
  public.xml public.json public.yaml
)

# Specific language/source UTIs (belt-and-suspenders for types that ship their own).
SPECIFIC=(
  public.c-source public.c-header public.c-plus-plus-source public.c-plus-plus-header
  public.objective-c-source public.objective-c-plus-plus-source
  public.swift-source public.assembly-source public.fortran-source public.pascal-source
  public.lisp-source public.python-script public.ruby-script public.perl-script
  public.php-script public.csh-script public.make-source public.java-source
  com.sun.java-source com.netscape.javascript-source
  public.html public.css net.daringfireball.markdown
  public.comma-separated-values-text public.tab-separated-values-text public.log
)

set_handler() { # <uti>
  if duti -s "$ZED_ID" "$1" all 2>/dev/null; then
    echo "  set  $1"
  else
    echo "  skip $1 (no such UTI on this system)"
  fi
}

echo "Setting Zed ($ZED_ID) as default editor..."
for uti in "${UMBRELLA[@]}" "${SPECIFIC[@]}"; do set_handler "$uti"; done
echo "Done. (Changes take effect for newly opened files; some apps may need a relogin.)"
