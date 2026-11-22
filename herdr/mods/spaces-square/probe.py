#!/usr/bin/env python3
"""Helper for the agents-plus and beads mods (local machine only).

  probe.py agents          Claude Code agents in herdr terminals: terminal -> account.
  probe.py usage <dir>     Plan usage for the Claude config dir <dir> ("" = ~/.claude).
  probe.py beads <cwd>     Open beads of the beads workspace containing <cwd>.
  probe.py stamp <root>    What changes when the beads data changes (and not when bd only reads).

Prints one JSON object. Never prints a credential.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

HOME = os.path.expanduser("~")


def out(obj):
    json.dump(obj, sys.stdout)
    sys.stdout.write("\n")


# ---------- agents ----------

def claude_processes():
    """pid -> env of every running `claude` process that has HC_TERMINAL_ID."""
    ps = subprocess.run(["ps", "-axo", "pid=,comm="], capture_output=True, text=True).stdout
    pids = [l.split()[0] for l in ps.splitlines() if l.strip().endswith("claude") or l.strip().split("/")[-1] == "claude"]
    procs = {}
    for pid in pids:
        cmd = subprocess.run(["ps", "eww", "-o", "command=", "-p", pid], capture_output=True, text=True).stdout
        env = dict(m.groups() for m in re.finditer(r"(?:^|\s)(HC_TERMINAL_ID|CLAUDE_CONFIG_DIR)=(\S+)", cmd))
        if "HC_TERMINAL_ID" in env:
            procs[int(pid)] = env
    return procs


def account_email(config):
    f = os.path.join(config, ".claude.json") if config else os.path.join(HOME, ".claude.json")
    try:
        with open(f) as fh:
            return ((json.load(fh).get("oauthAccount") or {}).get("emailAddress"))
    except (OSError, ValueError):
        return None


def cmd_agents():
    agents = {}
    for pid, env in claude_processes().items():
        config = env.get("CLAUDE_CONFIG_DIR", "")
        agents[env["HC_TERMINAL_ID"]] = {"pid": pid, "config": config, "email": account_email(config)}
    out({"agents": agents})


# ---------- usage ----------

def cmd_usage(config):
    service = "Claude Code-credentials"
    if config:
        service += "-" + hashlib.sha256(config.encode()).hexdigest()[:8]
    r = subprocess.run(["security", "find-generic-password", "-s", service, "-w"], capture_output=True, text=True)
    if r.returncode != 0:
        return out({"error": f"no keychain entry {service}"})
    try:
        oauth = json.loads(r.stdout)["claudeAiOauth"]
    except (ValueError, KeyError):
        return out({"error": "unreadable credentials"})
    import time
    if oauth.get("expiresAt") and oauth["expiresAt"] < time.time() * 1000:
        return out({"error": "token expired: start claude on this account to refresh it",
                    "plan": oauth.get("subscriptionType")})
    req = urllib.request.Request("https://api.anthropic.com/api/oauth/usage", headers={
        "Authorization": "Bearer " + oauth["accessToken"],
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "herdr-agents-plus",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as e:
        return out({"error": f"usage API HTTP {e.code}", "status": e.code})
    except (urllib.error.URLError, OSError, ValueError) as e:
        return out({"error": f"usage API: {e}"})
    # Bars: the account's own limits. A 5-hour bar only when the account has a session
    # limit; model-scoped weekly limits only once they have use.
    bars = []
    for l in body.get("limits") or []:
        kind, pct = l.get("kind"), l.get("percent") or 0
        if kind == "session":
            bar = {"key": "session", "label": "5-hour", "hours": 5}
        elif kind == "weekly_all":
            bar = {"key": "weekly", "label": "Weekly", "hours": 168}
        elif kind == "weekly_scoped":
            scope = l.get("scope") or {}
            name = (scope.get("model") or {}).get("display_name") or (scope.get("surface") or {}).get("display_name") or "scoped"
            if pct <= 0:
                continue
            bar = {"key": "weekly-" + name.lower(), "label": "Weekly " + name, "hours": 168}
        else:
            continue
        bar.update({"percent": pct, "resets_at": l.get("resets_at"), "severity": l.get("severity")})
        bars.append(bar)
    if not bars:  # older shape: the named windows
        for key, label, hours in (("five_hour", "5-hour", 5), ("seven_day", "Weekly", 168)):
            w = body.get(key)
            if isinstance(w, dict) and w.get("utilization") is not None:
                bars.append({"key": "session" if hours == 5 else "weekly", "label": label, "hours": hours,
                             "percent": w["utilization"], "resets_at": w.get("resets_at")})
    # Spend caps (Enterprise, or extra usage turned on): money used against a monthly limit.
    spend = body.get("spend") or {}
    used, limit = (spend.get("used") or {}), (spend.get("limit") or {})
    if spend.get("enabled") and limit.get("amount_minor"):
        exp = limit.get("exponent", 2)
        money = lambda m: m.get("amount_minor", 0) / (10 ** m.get("exponent", exp))
        bars.append({"key": "spend", "label": "Monthly spend", "hours": None,
                     "percent": spend.get("percent") if spend.get("percent") is not None
                     else 100 * money(used) / money(limit),
                     "resets_at": None, "severity": spend.get("severity"),
                     "used": money(used), "limit": money(limit),
                     "currency": limit.get("currency") or used.get("currency") or "USD"})
    order = {"session": 0, "weekly": 1}
    bars.sort(key=lambda b: order.get(b["key"], 2))
    out({"plan": oauth.get("subscriptionType"), "bars": bars})


# ---------- beads ----------

def beads_root(cwd):
    d = os.path.abspath(cwd or HOME)
    while True:
        # A workspace's .beads has metadata.json; ~/.beads is bd's own machine data, not one.
        if os.path.isfile(os.path.join(d, ".beads", "metadata.json")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def cmd_root(cwd):
    out({"root": beads_root(cwd)})


def cmd_beads(cwd):
    d = beads_root(cwd)
    if not d:
        return out({"root": None})
    r = subprocess.run(["bd", "list", "--json", "--flat", "--brief", "--limit", "0",
                        "--status", "open,in_progress,blocked"],
                       cwd=d, capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        return out({"root": d, "stamp": stamp(d), "error": (r.stderr or r.stdout).strip()[-300:]})
    try:
        issues = json.loads(r.stdout or "[]")
    except ValueError:
        return out({"root": d, "error": "bd list: not JSON"})
    ready = set()
    r2 = subprocess.run(["bd", "ready", "--json", "--brief", "--limit", "0"],
                        cwd=d, capture_output=True, text=True, timeout=30)
    if r2.returncode == 0:
        try:
            ready = {i.get("id") for i in json.loads(r2.stdout or "[]")}
        except ValueError:
            pass
    keep = ("id", "title", "status", "priority", "issue_type", "assignee", "updated_at", "parent")
    out({"root": d, "stamp": stamp(d),
         "issues": [dict({k: i.get(k) for k in keep}, ready=i.get("id") in ready) for i in issues]})


def stamp(root):
    """Embedded Dolt appends every write to its journal and moves its manifest; reads only
    touch mtimes. Size + manifest text change exactly when the data does."""
    base = os.path.join(root, ".beads", "embeddeddolt")
    parts = []
    for dirpath, _dirs, files in os.walk(base):
        if not dirpath.endswith(os.path.join(".dolt", "noms")):
            continue
        for f in sorted(files):
            path = os.path.join(dirpath, f)
            try:
                if f == "manifest":
                    with open(path, "rb") as fh:
                        parts.append(hashlib.sha1(fh.read()).hexdigest()[:12])
                elif f != "LOCK":
                    parts.append(f"{f[:6]}:{os.path.getsize(path)}")
            except OSError:
                pass
    return "|".join(parts) or None


def cmd_stamp(root):
    out({"stamp": stamp(root)})


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    arg = sys.argv[2] if len(sys.argv) > 2 else ""
    if cmd == "agents":
        cmd_agents()
    elif cmd == "usage":
        cmd_usage(arg)
    elif cmd == "beads":
        cmd_beads(arg)
    elif cmd == "root":
        cmd_root(arg)
    elif cmd == "stamp":
        cmd_stamp(arg)
    else:
        out({"error": "usage: probe.py agents | usage <config dir> | beads <cwd> | root <cwd>"})
