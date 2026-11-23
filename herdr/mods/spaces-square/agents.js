// Agents under their space: the rows the agents list (agents-plus) drew, moved here so
// spaces and agents are one list. Each space row is followed by its agents; each agent
// by the beads it holds (extras.js) and its live sub-agents.

import { div, image, svg, Background, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, terminals, panes, spaces, run } from "herdr";
import { beadLines } from "./extras.js";

// The highlight border ("this is the selected one"): temporal.io's "ultraviolet" button
// border, a 45° blue-to-purple gradient (#444ce7 to #b664ff), here 1px. Elements only
// take solid colors, so the gradient is painted as a rectangle under the element,
// which sits 1px in from each edge.
// As the shipped win98 mod paints its gradients: the painted layer itself is absolute and
// full size (a path's percentages are of its own bounds), and its path is built per draw.
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const gradientFrame = (el) => div().relative().p(1).flex_none()
  .child(globalThis.window.paint_path(RECT(), Background.linear_gradient(45, "#444ce7", "#b664ff")).absolute().top(0).left(0).size_full())
  .child(el.relative());

// Selected, as temporal.io marks the active item: a 4px mint bar down the left edge,
// on a faint indigo tint (theme "raised") instead of a filled blue row.
const selected = (el, t) => el.relative().bg(t.raised).child(div().absolute().top(0).left(0).w(4).h_full().bg("#59fda0"));

// Agent rows sit at the top level, as in the agents list.
const INDENT = 8;

// Drops what an agent puts before its title: a status glyph or spinner and the separator
// after it ("✦  Working", "⠋ - Thinking"), and Codex's blinking "[ ! ] " / "[ . ] " mark.
// Stops at an opening bracket or quote, so a title that starts with one ("[web] login") keeps it,
// and at an emoji ("🔴 login", "❤️ deploy"), except for known status marks.
const clean = (s) => (s ?? "").replace(/^(?:\[ [!.] \] |[✋⏳]\uFE0F?(?=\s)|(?!(?:\p{Emoji}\uFE0F|[#*]\u20E3))[^\p{L}\p{N}\p{Ps}\p{Pi}\p{Emoji_Presentation}])+/u, "").trim();

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
// A kept sub-agent (one with a pane) is in agents() too: it keeps its own status, done included.
const kidStatus = (k, listed) => {
  if (listed.has(k.address)) return listed.get(k.address);
  const s = k.status;
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

// Every space's agent rows: { rows: spaceId -> [(checkout line, space) -> elements], members: spaceId -> agents,
// focused: ids of spaces whose agent has the focus }. `v` is the Spaces view (state:
// changed, agentFolded, probe).
// A repo's spaces with agents, framed like a terminal pane: a 1px border (the accent when
// one of its spaces is shown, as a focused pane's is) and a 30px header like the pane
// header with the main space's name; its chevron folds the panel, a click shows the
// space, right-click is its menu. Inside, a sub-header per checkout (the main one, then
// each worktree) a row per agent, the checkout as a small line under the agent's name: the
// branch icon and the branch (a worktree: its name, and its branch when it differs). A checkout
// without agents is one row named after its first tab (so renaming the tab renames it), the
// checkout under it the same way. A space outside any repo has no checkout line.
export function familyCard(v, t, fam) {
  const main = fam[0].w;
  const id = `sp-${main.id}`;
  const open = !v.agentFolded.has(id);
  const all = fam.flatMap((r) => v.agents.members.get(r.w.id) ?? []);
  const top = all.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
  const head = h_flex().id(`group-${main.id}`).h(30).flex_none().px(10).gap(8).items_center()
    .bg(t.background).when(open, (el) => el.border_b(1).border_color(t.border)).text_size(12)
    .cursor_pointer().hover((s) => s.bg(t.hover))
    .on_click(() => run("space.select", { id: main.id }))
    .on_mouse_down("right", () => v.menu(main))
    .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(main.name))
    .when(!open, (el) => el
      .child(div().flex_none().text_color(t.dim).child(String(all.length)))
      .when(Boolean(top) && top !== "idle", (el) => el.child(statusMark(t, { status: top }))))
    .child(div().id(`group-fold-${main.id}`).flex_none().p(3).rounded(0).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(open ? "Fold" : "Unfold")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        open ? v.agentFolded.add(id) : v.agentFolded.delete(id);
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12)));

  const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  const body = fam.flatMap((r, n) => {
    const { w, g } = r;
    const makers = v.agents.rows.get(w.id) ?? [];
    // Main checkout: its branch. A worktree: the space's name (usually the branch), and the
    // branch when it differs. Not a repo and no worktrees: nothing to say.
    const branch = g?.branch ?? (g ? "detached" : null);
    const label = r.tree ? w.name : branch ?? w.name;
    const extra = r.tree && branch && !same(branch, w.name) ? branch : null;
    const checkout = !g && fam.length === 1 ? null : h_flex().min_w(0).gap(5).items_center().text_size(11).text_color(t.dim)
      .child(svg("mods/workspace-chrome/branch.svg").size(10).flex_none().text_color(w.active ? t.accent : t.dim))
      .child(div().flex_none().max_w(150).truncate().text_color(w.active ? t.accent : t.muted).child(label))
      .when(Boolean(extra), (el) => el.child(div().flex_1().min_w(0).truncate().child(extra)))
      .when(g?.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g?.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
    const els = makers.length ? makers.flatMap((make) => make(checkout, w)) : [plainRow(v, t, w, checkout)];
    return n > 0 ? [div().h(1).flex_none().bg(t.border), ...els] : els;
  });

  const card = v_flex().id(`card-${main.id}`).flex_none().bg(t.background)
    .child(head)
    .when(open, (el) => el.child(v_flex().children(body)));
  // The space you're in: the highlight border. The others: a plain gray one.
  return fam.some((r) => r.w.active) ? gradientFrame(card).my(4) : card.my(4).border(1).border_color(t.border);
}

// A checkout without agents: its first tab's name (as an agent row would name it), the checkout under it.
function plainRow(v, t, w, checkout) {
  const tab = w.tabs?.[0];
  const lead = tab ? v.agents.leads.get(tab.id) : null;
  const name = tab ? title(tab, lead) : w.name;
  const pic = icon(lead?.program, 16, t.foreground);
  const on = w.active && !v.agents.focused.has(w.id);
  return h_flex().id(`checkout-${w.id}`).pl(INDENT).pr(8).h(checkout ? 42 : 30).flex_none().rounded(0).items_center().gap(9)
    .when(on, (el) => selected(el, t))
    .cursor_pointer().hover((s) => s.bg(t.hover))
    .on_click(() => run("space.select", { id: w.id }))
    .on_mouse_down("right", () => v.menu(w))
    .child(div().w(16).flex_none().when(Boolean(pic), (el) => el.child(pic)))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().truncate().text_color(t.foreground).child(name || w.name))
      .when(Boolean(checkout), (el) => el.child(checkout)));
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

  // `checkout`: the small branch line under the name, or null; `w`: the agent's space (right-click is its menu).
  const row = (a, subs, checkout, w) => {
    const pic = icon(a.program, 16, t.foreground);
    const when = v.changed[a.address]?.at ?? 0;
    const idle = a.status === "idle" && !a.focused;
    return h_flex().id(`ag-${a.address}`).pl(INDENT).pr(8).h(checkout ? 42 : 30).flex_none().rounded(0).items_center().gap(9)
      .when(a.focused, (el) => selected(el, t))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .when(Boolean(w), (el) => el.on_mouse_down("right", () => v.menu(w)))
      .when(Boolean(pic), (el) => el.child(div().id(`agent-fold-${a.address}`)
        .when(subs.length > 0, (el) => el.on_click((_e, cx) => {
          cx.stop_propagation();
          v.agentFolded.has(a.address) ? v.agentFolded.delete(a.address) : v.agentFolded.add(a.address);
          cx.notify();
        })).child(pic)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_color(idle ? t.muted : t.foreground).child(nameOf(a)))
        .when(Boolean(checkout), (el) => el.child(checkout)))
      .when(subs.length > 0, (el) => el.child(fold(a, subs)))
      .when(Boolean(when), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
      .child(statusMark(t, a));
  };

  const shown = list.find((a) => a.focused)?.address ?? null;
  const rows = new Map(), members = new Map(), focused = new Set();
  for (const a of list) {
    const subs = tree(all, a.address);
    // Built once the card knows the checkout line to put under the name.
    const make = (checkout, w) => [row(a, subs, checkout, w), ...beadLines(t, a), ...(v.agentFolded.has(a.address) ? [] : subs.map((s) => subRow(s, shown)))];
    if (!rows.has(a.space)) { rows.set(a.space, []); members.set(a.space, []); }
    rows.get(a.space).push(make);
    members.get(a.space).push(a);
    if (a.focused) focused.add(a.space);
  }
  return { rows, members, focused, leads };
}
