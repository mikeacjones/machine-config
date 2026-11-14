#!/usr/bin/env python3
"""Claude Code PreToolUse hook: strip Claude attribution from what a tool call
is about to publish, and let the call run.

Attribution is a Claude co-author trailer, a "Generated with [Claude Code]"
line, a Claude-Session link, or a standalone "written by Claude" statement.

For Bash it rewrites commands that publish text (gh create/edit/comment/api
writes, bd writes, git commit/merge/tag/notes): the command text itself, and,
in place, the body or message files the command names. Other commands, such as
a search for attribution, are left exactly as written. For MCP tools it
rewrites every string in the input.

It never blocks a call. A "written by Claude" statement that is part of a
longer sentence is left alone, because removing it would garble the sentence.
"""

import json
import os
import re
import shlex
import sys

ROBOT = r"(?:\U0001F916|\\ud83e\\udd16)"

REMOVALS = [
    # Co-Authored-By: Claude ... <noreply@anthropic.com>
    re.compile(r"[ \t]*co-authored-by:[^\n|\"'`]*<noreply@anthropic\.com>[ \t]*\n?", re.I),
    # Generated with [Claude Code](https://claude.com/claude-code)
    re.compile(ROBOT + r"?[ \t]*generated with \[claude code\]\([^)\s]*\)[ \t]*\n?", re.I),
    # Claude-Session: https://...
    re.compile(r"[ \t]*claude-session:[ \t]*https?://[^\s\"'`)]+[ \t]*\n?", re.I),
]

# A statement that stands alone: it starts a line, a quoted string or a
# sentence, and nothing follows "Claude" or "Claude Code" but the end of one.
STATEMENT = re.compile(
    r"(?P<pre>^|\n|\\n|[\"']|[.!?][ \t]+)"
    r"[ \t>*_~—–-]*" + ROBOT + r"?[ \t]*"
    r"(?:(?:[\w-]+[ \t]+){0,4}?(?:(?:was|is|were)[ \t]+)?)?"
    r"(?:written|authored|generated|created|drafted|filed|opened|reported|produced)"
    r"\s+(?:by|with|using)\s+\[?claude(?:\s+code)?\]?(?:\([^)\s]*\))?[.!]?[*_~]*"
    r"(?=[ \t]*(?:$|\n|\\n|[\"']))",
    re.I)

PUBLISHES = re.compile(
    r"(^|[\s;&|(`$])(?:"
    r"gh\s+(?:issue|pr|release|gist|discussion|repo|project|label)\s+"
    r"(?:create|new|edit|comment|review|merge|close|reopen)\b"
    r"|gh\s+api\b[^\n;&|]*(?:\s-[fFX]\b|\s--(?:field|raw-field|input|method)\b)"
    r"|bd\s+(?:create|new|q|update|edit|close|reopen|comment|comments|note|remember|label)\b"
    r"|git\s[^\n;&|]*\b(?:commit|merge|tag|notes|commit-tree)\b"
    r")")

FILE_OPTION = re.compile(r"^(?:-F|--input|--[a-z-]*(?:file|path))$")
FILE_OPTION_INLINE = re.compile(r"^(?:--input|--[a-z-]*(?:file|path))=(.+)$")
FIELD_FROM_FILE = re.compile(r"^(?:[^=\s]+=)?@(.+)$")
CAT_SUBSTITUTION = re.compile(r"\$\(\s*(?:cat\s+|<\s*)([^)|;&]+?)\s*\)")
MAX_FILE_BYTES = 512 * 1024


def strip(text):
    for pattern in REMOVALS:
        text = pattern.sub("", text)
    return STATEMENT.sub(lambda match: match.group("pre"), text)


def named_files(command):
    for match in CAT_SUBSTITUTION.finditer(command):
        yield match.group(1).strip("\"'")
    try:
        tokens = shlex.split(command, comments=False, posix=True)
    except ValueError:
        tokens = command.split()
    previous = ""
    for token in tokens:
        inline = FILE_OPTION_INLINE.match(token)
        field = FIELD_FROM_FILE.match(token)
        if inline:
            yield inline.group(1)
        elif field:
            yield field.group(1)
        elif FILE_OPTION.match(previous) and "=" not in token:
            yield token
        previous = token


def strip_file(name, cwd):
    path = os.path.expanduser(name)
    if not os.path.isabs(path):
        path = os.path.join(cwd, path)
    try:
        if not os.path.isfile(path) or os.path.getsize(path) > MAX_FILE_BYTES:
            return False
        with open(path, encoding="utf-8", newline="") as handle:
            before = handle.read()
        after = strip(before)
        if after == before:
            return False
        after = after.rstrip() + ("\n" if before.endswith("\n") else "")
        with open(path, "w", encoding="utf-8", newline="") as handle:
            handle.write(after)
        return True
    except (OSError, UnicodeError):
        return False


def strip_strings(value):
    if isinstance(value, str):
        return strip(value)
    if isinstance(value, dict):
        return {key: strip_strings(item) for key, item in value.items()}
    if isinstance(value, list):
        return [strip_strings(item) for item in value]
    return value


def main():
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return
    tool_input = event.get("tool_input")
    if not isinstance(tool_input, dict):
        return

    changed_files = []
    if event.get("tool_name") == "Bash":
        command = tool_input.get("command") or ""
        if not PUBLISHES.search(command):
            return
        cwd = event.get("cwd") or os.getcwd()
        seen = set()
        for name in named_files(command):
            if name not in seen and strip_file(name, cwd):
                changed_files.append(name)
            seen.add(name)
        updated = dict(tool_input, command=strip(command))
    else:
        updated = strip_strings(tool_input)

    if updated == tool_input and not changed_files:
        return

    note = "Claude attribution was removed before this call ran"
    if changed_files:
        note += " (also from: %s)" % ", ".join(changed_files)
    output = {
        "hookEventName": "PreToolUse",
        "additionalContext": note + ". Do not add Claude or Claude Code "
        "attribution to commits, pull requests, issues, comments or beads.",
    }
    if updated != tool_input:
        output["updatedInput"] = updated
    json.dump({"hookSpecificOutput": output}, sys.stdout)


if __name__ == "__main__":
    main()
