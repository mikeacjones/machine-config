// Agents under their space: the rows the agents list (agents-plus) drew, moved here so
// spaces and agents are one list. Each space row is followed by its agents; each agent
// by the beads it holds (extras.js) and its live sub-agents.

import { div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, terminals, panes, spaces, run } from "herdr";
import { beadLines } from "./extras.js";

// Agent rows sit at the top level, as in the agents list.
const INDENT = 8;

// Drops what an agent puts before its title: a status glyph or spinner and the separator
// after it ("✦  Working", "⠋ - Thinking"), and Codex's blinking "[ ! ] " / "[ . ] " mark.
// Stops at an opening bracket or quote, so a title that starts with one ("[web] login") keeps it.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== (l?.terminal ?? l?.address) && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export function statusMark(t, a) {
  const color = t[a.status] ?? t.dim;
  if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(0).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
  // Idle: a ring; done: a dot.
  if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(0).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(7).mx(3).flex_none().rounded(0).bg(a.status === "done" ? color : t.dim + "00");
}

// Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
function tree(all, addr, lead = []) {
  const kids = all.filter((k) => k.parent === addr && k.state === "live");
  return kids.flatMap((k, i) => {
    const last = i === kids.length - 1;
    return [{ t: k, lines: [...lead, last ? "└" : "├"] }, ...tree(all, k.address, [...lead, last ? "" : "│"])];
  });
}

// Stamps agents whose state changed (the "3m" on a row). Done and idle count as one:
// looking at a finished agent turns done into idle, and looking isn't the agent doing anything.
function track(v, list, now) {
  let dirty = false;
  for (const a of list) {
    const s = a.status === "done" ? "idle" : a.status;
    if (v.changed[a.address]?.s === s) continue;
    v.changed[a.address] = { s, at: now };
    dirty = true;
  }
  if (!dirty) return;
  const listed = new Set(list.map((a) => a.address));
  for (const [k, c] of Object.entries(v.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete v.changed[k];
  try { localStorage.setItem("changed", JSON.stringify(v.changed)); } catch {}
}

// Every space's agent rows: { rows: spaceId -> elements, members: spaceId -> agents,
// focused: ids of spaces whose agent has the focus }. `v` is the Spaces view (state:
// changed, agentFolded, probe).
// A space's header over its agents, as the agents list grouped them: the space's name
// (it folds the group); folded, how many agents and the most urgent state.
export function groupHeader(v, t, w, members) {
  const id = `sp-${w.id}`;
  const open = !v.agentFolded.has(id);
  const top = members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
  return h_flex().id(`group-${w.id}`).px(8).pt(8).h(30).flex_none().gap(6).items_center()
    .text_size(11).font_medium().cursor_pointer()
    .hover((s) => s.text_color(t.foreground))
    .on_click((_e, cx) => {
      open ? v.agentFolded.add(id) : v.agentFolded.delete(id);
      cx.notify();
    })
    .on_mouse_down("right", () => v.menu(w))
    .child(div().truncate().text_color(t.dim).child(w.name))
    .when(!open, (el) => el.child(div().text_color(t.dim).child(String(members.length))))
    .child(div().flex_1())
    .when(!open, (el) => el
      .when(Boolean(top) && top !== "idle", (el) => el.child(statusMark(t, { status: top })))
      .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
}

export function agentRows(v, t, cx) {
  let list = agents();
  const listed = new Map(list.map((a) => [a.address, a.status]));
  const all = terminals();
  const now = Date.now();
  track(v, list, now);
  v.probe.sync(list.map((a) => a.address), cx);
  // A kept sub-agent (one with a pane) is in agents() too: its parent's tree shows it.
  const nested = new Set(list.flatMap((a) => tree(all, a.address).map((s) => s.t.address)));
  list = list.filter((a) => !nested.has(a.address));

  // A row names the tab someone named, or the agent's own title; never an automatic tab
  // number unless two rows in the space would otherwise read the same.
  const tabCounts = new Map();
  for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
  const leads = leadPanes(panes());
  const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
  const label = new Map(list.map((a) => {
    const tab = tabs.get(a.tab);
    const many = tabCounts.get(a.tab) > 1;
    return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
  }));
  const nameOf = (a) => {
    const l = label.get(a.address);
    return /^\d+$/.test(l) ? a.program?.name || l : l;
  };

  const fold = (a, subs) => {
    const sts = subs.map((s) => kidStatus(s.t, listed));
    const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
    const open = !v.agentFolded.has(a.address);
    return div().id(`fold-${a.address}`).h(18).px(3).gap(3).flex().items_center().rounded(0).text_size(11)
      .text_color(open ? t.dim : (t[top] ?? t.dim)).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        open ? v.agentFolded.add(a.address) : v.agentFolded.delete(a.address);
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .when(!open, (el) => el.child(String(subs.length)));
  };

  const subRow = (s, shown) => {
    const k = s.t;
    const st = kidStatus(k, listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex().id(`sub-${k.address}`).pl(39).pr(8).rounded(0).h(26).flex_none().gap(0).items_center().text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : run("terminal.peek", { terminal: k.address })))
      .children(s.lines.map((l) => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5))))
      .when(Boolean(pic), (el) => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(statusMark(t, { status: st }));
  };

  const row = (a, subs) => {
    const pic = icon(a.program, 16, t.foreground);
    const when = v.changed[a.address]?.at ?? 0;
    const idle = a.status === "idle" && !a.focused;
    return h_flex().id(`ag-${a.address}`).pl(INDENT).pr(8).h(30).flex_none().rounded(0).items_center().gap(9)
      .when(a.focused, (el) => el.bg(t.selected))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .when(Boolean(pic), (el) => el.child(div().id(`agent-fold-${a.address}`)
        .when(subs.length > 0, (el) => el.on_click((_e, cx) => {
          cx.stop_propagation();
          v.agentFolded.has(a.address) ? v.agentFolded.delete(a.address) : v.agentFolded.add(a.address);
          cx.notify();
        })).child(pic)))
      .child(div().flex_1().min_w(0).truncate().text_color(idle ? t.muted : t.foreground).child(nameOf(a)))
      .when(subs.length > 0, (el) => el.child(fold(a, subs)))
      .when(Boolean(when), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
      .child(statusMark(t, a));
  };

  const shown = list.find((a) => a.focused)?.address ?? null;
  const rows = new Map(), members = new Map(), focused = new Set();
  for (const a of list) {
    const subs = tree(all, a.address);
    const els = [row(a, subs), ...beadLines(t, a), ...(v.agentFolded.has(a.address) ? [] : subs.map((s) => subRow(s, shown)))];
    if (!rows.has(a.space)) { rows.set(a.space, []); members.set(a.space, []); }
    rows.get(a.space).push(...els);
    members.get(a.space).push(a);
    if (a.focused) focused.add(a.space);
  }
  return { rows, members, focused };
}
