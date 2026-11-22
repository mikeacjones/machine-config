// What agents-plus adds to the shipped agents list:
// - under each agent, the beads it holds: in progress and assigned to <actor>@<terminal>
//   (BEADS_ACTOR, set per herdr terminal in ~/.zshrc), from the beads panel's shared list;
// - at the bottom, one card per Claude account with running agents: its plan usage, one bar
//   per limit the account has, and a "full by" estimate only when that lands before the reset.
// Account per agent comes from probe.py (local machine only).

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, shared, spaces, panes, focused, run } from "herdr";

const USAGE_EVERY = 180000;
const SAMPLES_KEEP = 8 * 86400000;

export class Probe {
  constructor() {
    this.agents = {}; // terminal -> { config, email }
    this.usage = {}; // config -> { bars, error, at }
    this.next = {}; // config -> when to fetch next
    this.seen = null; // the agent addresses the last mapping was made for
    try { this.samples = JSON.parse(localStorage.getItem("samples") ?? "{}") || {}; } catch { this.samples = {}; }
  }

  async py(args) {
    const r = await exec("python3", ["-B", `${appHome()}/mods/agents-plus/probe.py`, ...args], { timeout: 45000 });
    return JSON.parse(r.stdout);
  }

  start(cx) {
    this.live = true;
    cx.timer.every(USAGE_EVERY, (cx) => this.tick(cx, true));
  }

  // Called on render: maps terminals to accounts when the set of agents changes.
  sync(addresses, cx) {
    if (!this.live) return;
    const key = addresses.filter((a) => !a.includes("/")).sort().join(" ");
    if (key === this.seen) return;
    this.seen = key;
    this.tick(cx, false);
  }

  tick(cx, usage) {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const got = (await this.py(["agents"])).agents ?? {};
        if (JSON.stringify(got) !== JSON.stringify(this.agents)) { this.agents = got; cx.notify(); }
        const now = Date.now();
        for (const c of new Set(Object.values(got).map((a) => a.config ?? ""))) {
          if (!usage && this.usage[c]) continue; // a new agent: only accounts not fetched yet
          if ((this.next[c] ?? 0) > now) continue;
          this.next[c] = now + USAGE_EVERY - 5000;
          const u = await this.py(["usage", c]).catch((e) => ({ error: String(e) }));
          // Keep the last good bars through an error; back off on rate limits.
          if (u.status === 429) this.next[c] = now + 2 * USAGE_EVERY;
          this.usage[c] = u.bars ? { ...u, at: now } : { ...(this.usage[c] ?? {}), error: u.error };
          if (u.bars) this.record(c, u.bars, now);
          cx.notify();
        }
      } catch (e) {
        console.log(`agents-plus probe: ${e}`);
      } finally {
        this.busy = false;
        if (this.again) { this.again = false; this.tick(cx, false); }
      }
    });
  }

  // Usage samples per account and bar, for the fill-rate estimate.
  record(config, bars, now) {
    for (const b of bars) {
      const k = `${config}|${b.key}`;
      let list = this.samples[k] ?? [];
      // A new window (reset moved, or usage fell): start over.
      const last = list.at(-1);
      if (last && (last[2] !== b.resets_at || b.percent < last[1])) list = [];
      if (!last || last[1] !== b.percent || now - last[0] > 600000) list.push([now, b.percent, b.resets_at]);
      this.samples[k] = list.filter((s) => now - s[0] < SAMPLES_KEEP).slice(-400);
    }
    try { localStorage.setItem("samples", JSON.stringify(this.samples)); } catch {}
  }

  // When the bar reaches 100% at the current pace, or null. Pace: the recent samples
  // (the last hour for 5-hour, the last day for weekly) when they span enough time,
  // else the average since the window began.
  eta(config, b, now) {
    const reset = b.resets_at ? Date.parse(b.resets_at) : NaN;
    if (!(b.percent > 0) || b.percent >= 100 || !Number.isFinite(reset)) return null;
    const look = b.hours <= 5 ? 3600000 : 86400000;
    const span = b.hours <= 5 ? 600000 : 3600000;
    const list = (this.samples[`${config}|${b.key}`] ?? []).filter((s) => now - s[0] <= look);
    let rate = null; // percent per ms
    const first = list[0];
    if (first && now - first[0] >= span && b.percent > first[1]) rate = (b.percent - first[1]) / (now - first[0]);
    if (rate == null) {
      const started = reset - b.hours * 3600000;
      if (now - started > span) rate = b.percent / (now - started);
    }
    if (!(rate > 0)) return null;
    const full = now + (100 - b.percent) / rate;
    return full < reset ? full : null;
  }
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function clock(ms, now) {
  const d = new Date(ms);
  const h = d.getHours();
  const t = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
  return new Date(now).toDateString() === d.toDateString() ? t : `${DAYS[d.getDay()]} ${t}`;
}
function left(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fillColor(t, b) {
  if (b.percent >= 100 || b.severity === "critical") return t.blocked;
  if (b.percent >= 80 || b.severity === "warning") return t.ansi3;
  return t.accent;
}

// One card per account that has a running agent, below the list. With several accounts,
// the ones the open agent (address `open`) isn't using are faded.
export function accountCards(t, probe, now, open) {
  const accounts = new Map(); // config -> { email, terminals }
  for (const [term, a] of Object.entries(probe.agents)) {
    const c = a.config ?? "";
    if (!accounts.has(c)) accounts.set(c, { email: a.email, terminals: [] });
    accounts.get(c).terminals.push(term);
  }
  if (!accounts.size) return null;
  const current = open && probe.agents[open] ? (probe.agents[open].config ?? "") : null;
  const fade = (config) => accounts.size > 1 && current !== null && config !== current;
  const sorted = [...accounts.entries()].sort((x, y) => String(x[1].email).localeCompare(String(y[1].email)));
  // Each limit: label, percent and reset over a full-width bar; the reset turns into a
  // yellow "full ~…" when the pace fills the bar first. Labels: 5h, Wk, Wk <model>.
  const short = (b) => (b.key === "session" ? "5h" : b.key === "weekly" ? "Wk" : b.key === "spend" ? "Spend" : b.label.replace(/^Weekly /, "Wk "));
  const money = (n, cur) => `${cur === "USD" ? "$" : ""}${Math.round(n).toLocaleString("en-US")}${cur === "USD" ? "" : ` ${cur}`}`;
  return v_flex().id("accounts").flex_none().px(8).pt(8).pb(8).gap(6)
    .children(sorted.map(([config, acc]) => {
      const u = probe.usage[config];
      const rows = [];
      if (u?.bars?.length) {
        for (const b of u.bars) {
          const reset = b.resets_at ? Date.parse(b.resets_at) : NaN;
          const eta = probe.eta(config, b, now);
          const pct = Math.max(0, Math.min(100, b.percent));
          const when = b.key === "spend" ? `${money(b.used, b.currency)}/${money(b.limit, b.currency)}`
            : eta != null ? `full ~${clock(eta, now)}`
            : Number.isFinite(reset) ? `↻ ${b.hours <= 5 ? left(reset - now) : clock(reset, now)}` : "idle";
          // Two lines per limit: label, percent and reset on top, a full-width bar below.
          rows.push(v_flex().gap(4).id(`bar-${config}-${b.key}`)
            .tooltip(`${b.label}: ${Math.round(b.percent)}% used${Number.isFinite(reset) ? `, resets ${clock(reset, now)}` : ""}${eta != null ? `, full ~${clock(eta, now)} at this pace` : ""}`)
            .child(h_flex().gap(8).items_center().text_size(12.5)
              .child(div().flex_none().text_color(t.muted).child(short(b)))
              .child(div().flex_none().font_medium().text_color(t.foreground).child(`${Math.round(b.percent)}%`))
              .child(div().flex_1())
              .child(div().flex_none().truncate().text_color(eta != null ? t.ansi3 : t.dim).child(when)))
            .child(div().w_full().h(7).bg(t.border)
              .child(div().h(7).w(`${pct}%`).bg(fillColor(t, b)))));
        }
      } else {
        const plan = u?.plan ? `${u.plan[0].toUpperCase()}${u.plan.slice(1)} plan: ` : "";
        rows.push(div().text_size(12).text_color(t.dim).truncate()
          .child(u?.error ?? (u?.bars ? `${plan}no usage limits reported` : "usage…")));
      }
      return v_flex().id(`acct-${config || "default"}`).px(10).py(8).gap(8).rounded(0).bg(t.surface).border(1)
        .border_color(current === config && accounts.size > 1 ? t.input : t.border)
        .when(fade(config), (el) => el.opacity(0.4))
        .child(div().text_size(12.5).font_medium().truncate().text_color(t.foreground).child(acc.email ?? (config.split("/").pop() || "~/.claude")))
        .children(rows);
    }));
}

// The beads this agent holds: in progress, assigned to <actor>@<its terminal>.
export function beadLines(t, a) {
  if (a.address.includes("/")) return [];
  const pub = shared("beads.issues");
  const mine = Object.entries(pub?.issues ?? {})
    .filter(([, i]) => i.status === "in_progress" && String(i.assignee ?? "").endsWith(`@${a.address}`));
  const rows = mine.slice(0, 4).map(([id, i]) => h_flex()
    .id(`bead-${a.address}-${id}`)
    .flex_none()
    .pl(33)
    .pr(10)
    .h(18)
    .gap(6)
    .items_center()
    .text_size(11)
    .child(div().flex_none().text_color(t.working).child("◐"))
    .child(div().flex_none().text_color(t.foreground).child(id))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(i.title ?? "")));
  if (mine.length > 4) rows.push(div().pl(45).pb(2).text_size(10).text_color(t.dim).child(`+${mine.length - 4} more`));
  return rows;
}

// Shows the beads column (its layout id) only where the focused folder is in a beads workspace.
// This runs here, in an always-shown block, because Herdr starts a mod only when its block
// first shows: a beads column hidden at start could never show itself again.
export function followBeads(cx, id) {
  const where = () => {
    const space = spaces().find((s) => s.active), f = focused();
    if (space?.machine) return null; // beads are read on this computer only
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    return pane?.cwd || f?.cwd || space?.folder || null;
  };
  let cwd, shown;
  cx.timer.every(1000, (cx) => {
    const now = where();
    if (now === cwd) return;
    cwd = now;
    cx.spawn(async () => {
      let root = null;
      try {
        if (now) root = JSON.parse((await exec("python3", ["-B", `${appHome()}/mods/agents-plus/probe.py`, "root", now], { timeout: 15000 })).stdout).root;
      } catch (e) { console.log(`beads root: ${e}`); }
      if (cwd !== now) return;
      const show = Boolean(root);
      if (show !== shown) { shown = show; run(show ? "layout.show" : "layout.hide", { id }); }
    });
  });
}
