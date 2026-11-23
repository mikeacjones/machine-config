// Beads panel: the open beads of the beads workspace the focused terminal is in, and which
// agent holds which. An agent's claims carry its terminal: BEADS_ACTOR=<user>@<terminal>
// (~/.zshrc). Refreshes when the beads data changes (a watch on .beads, checked against
// probe.py's stamp so bd's own reads don't count), and when the focused folder moves.
// agents-plus shows its layout column only where the focused folder has beads.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, agents, exec, appHome, theme, settings, shared, setShared, run, props, checking, watchFolder, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// This panel's own zoom, separate from the app's (shared, so it's remembered).
const ZOOM_KEY = "beads.zoom";
const panelZoom = () => Math.min(2, Math.max(0.7, Number(shared(ZOOM_KEY)) || 1));

// Folded goes by the column's width, like the sidebar's rail: dragging it narrow folds it too.
const RAIL = 36;
const width = () => find(layout(), props()?.column)?.size?.px;
const folded = () => (width() ?? Infinity) < 160;
function toggleFold() {
  const id = props()?.column;
  if (!id) return;
  if (!folded()) setShared("beads.width", width());
  run("layout.resize", { id, px: folded() ? (shared("beads.width") ?? 360) : RAIL });
}

const LOOK_EVERY = 1000; // only compares the focused folder (a hidden column doesn't render); runs nothing
const probe = () => `${appHome()}/mods/spaces-square/probe.py`;
// "mikeacjones@t3" -> "t3", "mikeacjones@t2h" -> "t2h" (ids aren't only digits); null for a claim made outside a herdr terminal.
const holder = (i) => /@(t[0-9a-z]+)$/.exec(String(i.assignee ?? ""))?.[1] ?? null;

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  // Beads are read on this computer only.
  if (space?.machine) return null;
  return pane?.cwd || f?.cwd || space?.folder || null;
}

const PRIO = ["P0", "P1", "P2", "P3", "P4"];

export default class Beads extends View {
  init(_props, cx) {
    this.root = undefined; // undefined: not looked yet; null: no beads here
    this.issues = [];
    this.open = new Set(["agents", "progress", "ready"]);
    this.expanded = null;
    this.detail = {};
    // Parents folded or unfolded by hand (id -> true: open); the rest follow the default.
    try { this.fold = JSON.parse(localStorage.getItem("fold") ?? "{}") || {}; } catch { this.fold = {}; }
    if (checking()) return;
    this.refresh(cx);
    // Rendering also notices a move; this catches one while the column is hidden.
    cx.timer.every(LOOK_EVERY, (cx) => { if (location() !== this.cwd) this.refresh(cx); });
  }

  // Waits for changes under <root>/.beads; refreshes only when the data really changed.
  watch(root, cx) {
    if (this.watched === root) return;
    this.watching?.cancel();
    this.watched = root;
    if (!root) return;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          this.watching = watchFolder(`${root}/.beads`);
          await this.watching;
          if (this.watched !== root) return;
          const r = await exec("python3", ["-B", probe(), "stamp", root], { timeout: 15000 });
          const stamp = JSON.parse(r.stdout).stamp;
          if (stamp !== this.stamp && !this.loading) this.refresh(cx);
        }
      } catch (e) {
        console.log(`beads watch: ${e}`);
        if (this.watched === root) this.watched = null;
      }
    });
  }

  // Shows what's known at once: the last list read for this folder's workspace, or nothing
  // for a folder known to have none. The read that follows replaces it.
  showCached(cwd) {
    this.rootOf ??= new Map(); // folder -> workspace root (null: none)
    this.cache ??= new Map(); // root -> { issues, stamp }
    if (!this.rootOf.has(cwd)) return;
    const root = this.rootOf.get(cwd);
    const hit = root ? this.cache.get(root) : null;
    if (root && !hit) return;
    if (root !== this.root) { this.expanded = null; this.detail = {}; }
    this.root = root;
    this.issues = hit?.issues ?? [];
    this.stamp = hit?.stamp ?? null;
    this.error = null;
    this.publish();
  }

  refresh(cx) {
    const cwd = location();
    if (this.loading) return;
    this.cwd = cwd;
    this.showCached(cwd);
    cx.notify();
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = cwd ? await exec("python3", ["-B", probe(), "beads", cwd], { timeout: 60000 }) : null;
        const d = r ? JSON.parse(r.stdout) : { root: null };
        if (d.root !== this.root) { this.expanded = null; this.detail = {}; }
        this.root = d.root;
        this.stamp = d.stamp ?? null;
        this.error = d.error ?? null;
        // A failed read shows its error, not the last workspace's beads.
        this.issues = d.issues ?? [];
        this.rootOf.set(cwd, d.root ?? null);
        if (d.root && d.issues) this.cache.set(d.root, { issues: d.issues, stamp: d.stamp ?? null });
        this.publish();
        this.watch(d.root, cx);
      } catch (e) {
        this.error = String(e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  // agents-plus lists each agent's beads under it.
  publish() {
    if (!this.root) return;
    const issues = Object.fromEntries(this.issues.filter((i) => i.status === "in_progress")
      .map((i) => [i.id, { title: i.title, status: i.status, assignee: i.assignee }]));
    const value = { root: this.root, issues };
    const now = shared("beads.issues");
    if (JSON.stringify(now) !== JSON.stringify(value)) setShared("beads.issues", value);
  }

  foldParent(id, open, cx) {
    this.fold[id] = !open;
    try { localStorage.setItem("fold", JSON.stringify(this.fold)); } catch {}
    cx.notify();
  }

  toggle(id, cx) {
    this.open.has(id) ? this.open.delete(id) : this.open.add(id);
    cx.notify();
  }

  expand(id, cx) {
    this.expanded = this.expanded === id ? null : id;
    if (this.expanded && !this.detail[id]) {
      const root = this.root;
      cx.spawn(async (cx) => {
        const r = await exec("bd", ["show", id], { cwd: root, timeout: 30000 }).catch((e) => ({ stdout: String(e) }));
        this.detail[id] = (r.stdout || r.stderr || "").trim();
        cx.notify();
      });
    }
    cx.notify();
  }

  render(cx) {
    const t = theme();
    // Follow the terminal's text: its font, weight and size (sizes below were designed at 12.5).
    const s = settings();
    const mono = s.font_family ?? s.font ?? "JetBrains Mono";
    const weight = Number(s.font_weight) || 500;
    // The panel's own zoom on top (⌘+scroll over it; the header's "120%" resets it).
    const zoom = panelZoom();
    const z = (n) => (n * (Number(s.font_size) || 14) * zoom) / 12.5;
    // Framed like a terminal pane: the pane header's look (30px, the terminal background, a
    // bottom border), with its controls showing on hover as a pane's do.
    const button = (id, icon, tip, action) => div().id(id).p(3).rounded(0).text_color(t.dim)
      .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(`mods/beads/${icon}.svg`).size(14));
    const head = h_flex().id("bd-head").h(30).flex_none().px(10).gap(8).items_center()
      .bg(t.background).border_b(1).border_color(t.border).text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .child(svg("mods/beads/beads.svg").size(14).flex_none().text_color(t.dim))
      .child(div().flex_none().font_medium().text_color(t.foreground).child("Beads"))
      .child(div().flex_1().truncate().text_color(t.dim).child(this.root ? this.root.split("/").pop() : ""))
      .when(this.loading, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.dim).spin(900)))
      .when(zoom !== 1, (el) => el.child(div().id("bd-zoom").flex_none().px(4).text_color(t.dim).cursor_pointer()
        .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("Panel zoom: click for 100%")
        .on_click((_e, cx) => { cx.stop_propagation(); setShared(ZOOM_KEY, 1); cx.notify(); })
        .child(`${Math.round(zoom * 100)}%`)))
      .when(Boolean(this.hovered), (el) => el
        .child(button("bd-refresh", "refresh", "Refresh", (cx) => this.refresh(cx)))
        .child(button("bd-fold", "fold", "Collapse", () => toggleFold())));

    // Folded: a strip with the open button and how many beads are in progress.
    if (folded()) {
      const busy = this.issues.filter((i) => i.status === "in_progress").length;
      return v_flex().id("bd-rail").size_full().bg(t.background).items_center().gap(10)
        .cursor_pointer().hover((st) => st.bg(t.hover)).on_click(() => toggleFold()).tooltip("Expand beads")
        .child(h_flex().h(30).w_full().flex_none().justify_center().items_center().border_b(1).border_color(t.border)
          .child(svg("mods/beads/unfold.svg").size(14).text_color(t.dim)))
        .when(busy > 0, (el) => el.child(div().font_family(mono).text_size(z(11)).text_color(t.working).child(String(busy))));
    }
    const shell = (body) => v_flex().id("bd-shell").size_full().min_h(0).bg(t.background).font_family(mono).font_weight(weight)
      .text_size(z(12.5))
      // ⌘+scroll: zoom this panel alone, 10% a step (a trackpad's small moves add up).
      .on_scroll_wheel((e, cx) => {
        if (!e.modifiers.platform) return;
        cx.stop_propagation();
        this.wheel = (this.wheel ?? 0) + (e.delta_lines?.y ?? e.delta.y / 24);
        const steps = Math.trunc(this.wheel);
        if (!steps) return;
        this.wheel -= steps;
        setShared(ZOOM_KEY, Math.round(Math.min(2, Math.max(0.7, panelZoom() + steps * 0.1)) * 10) / 10);
        cx.notify();
      })
      .child(head).child(body);

    if (this.root === undefined) return shell(div().px(10).text_color(t.dim).text_size(z(12)).child("Looking for beads…"));
    if (!this.root) return shell(div().px(10).text_color(t.dim).text_size(z(12)).child("No beads workspace in this folder."));

    // Which live agent holds which bead (its terminal is in the assignee), and the agent
    // you have open: the focused terminal's, else the one an agent block shows.
    const live = new Map(agents().filter((a) => !a.address.includes("/")).map((a) => [a.address, a]));
    const f = focused();
    const me = live.get(f?.terminal) ?? live.get(f?.agent) ?? null;
    const workers = new Map(); // terminal -> issues
    for (const i of this.issues) {
      const term = i.status === "in_progress" ? holder(i) : null;
      if (!term || !live.has(term)) continue;
      if (!workers.has(term)) workers.set(term, []);
      workers.get(term).push(i);
    }
    const mine = me ? workers.get(me.address) ?? [] : [];
    const byPrio = (x, y) => (x.priority ?? 9) - (y.priority ?? 9) || String(y.updated_at).localeCompare(String(x.updated_at));
    // The parent/child tree, as bd list draws it. A parent whose parent isn't open is a root.
    const byId = new Map(this.issues.map((i) => [i.id, i]));
    const kids = new Map();
    for (const i of this.issues) {
      if (i.parent && byId.has(i.parent)) {
        if (!kids.has(i.parent)) kids.set(i.parent, []);
        kids.get(i.parent).push(i);
      }
    }
    for (const list of kids.values()) list.sort(byPrio);
    const roots = this.issues.filter((i) => !(i.parent && byId.has(i.parent))).sort(byPrio);
    // A parent with a child in progress is in progress; one with a ready child has ready work.
    const memo = new Map();
    const sub = (i) => {
      if (memo.has(i.id)) return memo.get(i.id);
      const r = { progress: i.status === "in_progress", ready: i.status !== "in_progress" && i.ready, count: 0 };
      memo.set(i.id, r);
      for (const k of kids.get(i.id) ?? []) {
        const c = sub(k);
        r.progress ||= c.progress; r.ready ||= c.ready; r.count += 1 + c.count;
      }
      return r;
    };
    // Each bead shows once. An agent's beads show under it as trees: one whose parent the same
    // agent holds shows inside that parent's tree, not again on its own. Whatever the agent
    // sections show (with everything under it) is left out of the sections below.
    const tops = (list) => {
      const ids = new Set(list.map((i) => i.id));
      return list.filter((i) => {
        for (let p = byId.get(i.parent); p; p = byId.get(p.parent)) if (ids.has(p.id)) return false;
        return true;
      });
    };
    const above = new Set();
    const mark = (i) => { above.add(i.id); for (const k of kids.get(i.id) ?? []) mark(k); };
    for (const list of workers.values()) for (const i of tops(list)) mark(i);
    const left = roots.filter((i) => !above.has(i.id));
    const progress = left.filter((i) => sub(i).progress);
    const ready = left.filter((i) => !sub(i).progress && sub(i).ready);
    const other = left.filter((i) => !sub(i).progress && !sub(i).ready);

    // Folded by default unless the parent has work in progress under it.
    const isOpen = (i) => this.fold[i.id] ?? sub(i).progress;
    // Rows as `bd list` prints them: tree lines, status glyph, id, priority, [type], title.
    const GLYPH = { open: "○", in_progress: "◐", blocked: "●", deferred: "❄", closed: "✓" };
    const MINE = "#7f86f1";
    // IDs padded to one width (the font is monospaced), so the priority tags after them line up.
    const IDW = Math.min(14, Math.max(0, ...this.issues.map((i) => i.id.length)));
    // Tree lines in slate, quiet like the grid lines in temporal.io's timeline.
    const TREE = "#374761";
    // Priority and epic as tags, the way temporal.io's timeline draws an activity: a 1px edge
    // on a faint tint of its color. P0 pink, P1 yellow, P2 periwinkle, lower ones slate
    // (with periwinkle text, for contrast). Epics get a line down their left edge (row, below).
    const tag = (text, edge, fill, color) => div().flex_none().mr(6).px(z(4)).h(z(16)).flex().items_center()
      .border(1).border_color(edge).bg(fill).text_size(z(10.5)).font_medium().text_color(color).child(text);
    const prioTag = (p) => {
      const edge = p === 0 ? t.blocked : p === 1 ? t.working : p === 2 ? t.dim : t.input;
      return tag(PRIO[p] ?? `P${p}`, edge, edge + "26", p >= 3 ? t.dim : edge);
    };
    // `hide`: beads shown elsewhere, left out of this tree. `inEpic`: the bead sits under an
    // epic header. Those keep a fold column on the left, so they read as indented under the
    // epic; a bead outside any epic starts where an epic's title does, its fold arrow on the
    // right like an epic's chevron.
    const row = (i, lead = [], indent = 0, hide = null, inEpic = false) => {
      const on = this.expanded === i.id;
      const children = (kids.get(i.id) ?? []).filter((k) => !hide?.has(k.id));
      const open = children.length > 0 && isOpen(i);
      const active = i.status === "in_progress" || sub(i).progress;
      const glyph = active ? GLYPH.in_progress : GLYPH[i.status] ?? "○";
      const who = i.status === "in_progress" ? holder(i) : null;
      const isMine = Boolean(me && who === me.address);
      // Status on Temporal's colors: yours lavender-blue (the focused pane's color), in progress
      // yellow, blocked pink, ready to start mint; the rest lavender.
      const glyphColor = isMine ? MINE : active ? t.working : i.status === "blocked" ? t.blocked : i.ready ? t.done : t.muted;
      const prefix = lead.map((l, n) => (n === lead.length - 1 ? (l === "└" ? "└── " : "├── ") : l === "├" ? "│   " : "    ")).join("");
      const details = () => div().ml(24 + indent).mr(10).mb(6).p(8).rounded(0).border(1).border_color(t.border).text_size(z(11))
        .font_family(mono).text_color(t.muted).whitespace_normal().child(this.detail[i.id] ?? "Loading…");
      // An epic is a header, like a space panel's in the sidebar: its title, the chevron on the
      // right folding it, a line under it when open; its beads follow without tree lines.
      if (i.issue_type === "epic") {
        return v_flex().flex_none().mt(4)
          .child(h_flex().id(`bd-${i.id}`).pl(10 + indent).pr(6).h(z(28)).gap(8).items_center()
            .when(open, (el) => el.border_b(1).border_color(t.border))
            .when(on, (el) => el.relative().bg(t.raised).child(div().absolute().top(0).left(0).w(4).h_full().bg("#59fda0")))
            .cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.expand(i.id, cx))
            .when(prefix.length > 0, (el) => el.child(div().flex_none().text_color(TREE).child(prefix)))
            .child(div().flex_none().text_color(glyphColor).child(glyph))
            .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(i.title ?? ""))
            .child(div().flex_none().text_size(z(11)).text_color(t.dim).child(i.id))
            .when(children.length > 0 && !open, (el) => el.child(div().flex_none().text_size(z(11)).text_color(t.dim).child(`+${sub(i).count}`)))
            .when(children.length > 0, (el) => el.child(div().id(`fold-${i.id}`).flex_none().p(3).rounded(0).text_color(t.dim)
              .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(open ? "Fold" : "Unfold")
              .on_click((_e, cx) => { cx.stop_propagation(); this.foldParent(i.id, open, cx); })
              .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(z(12))))))
          .when(on, (el) => el.child(details()))
          .when(open, (el) => el.children(children.map((k) => row(k, lead, indent, hide, true))));
      }
      const fold = () => div().id(`fold-${i.id}`).w(14).flex_none().text_size(z(10)).text_color(t.dim)
        .when(children.length > 0, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.foldParent(i.id, open, cx); })
          .child(open ? "▾" : "▸"));
      return v_flex().flex_none()
        .child(h_flex().id(`bd-${i.id}`).pl(10 + indent).pr(10).h(z(22)).items_center().rounded(0)
          .font_family(mono).text_size(z(12.5)).whitespace_nowrap()
          .when(on, (el) => el.relative().bg(t.raised).child(div().absolute().top(0).left(0).w(4).h_full().bg("#59fda0"))) // temporal.io's mint marker
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.expand(i.id, cx))
          .when(inEpic, (el) => el.child(fold()))
          .when(prefix.length > 0, (el) => el.child(div().flex_none().text_color(TREE).child(prefix)))
          .child(div().flex_none().text_color(glyphColor).child(`${glyph} `))
          .child(div().flex_none().text_color(t.foreground).child(`${i.id.padEnd(IDW, "\u00a0")} `))
          .when(i.priority != null, (el) => el.child(prioTag(i.priority)))
          .when(Boolean(who), (el) => el.child(div().flex_none().text_color(isMine ? MINE : t.dim).child(`@${who} `)))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(i.title ?? ""))
          .when(children.length > 0 && !open, (el) => el.child(div().flex_none().pl(6).text_size(z(10.5)).text_color(t.dim).child(`+${sub(i).count}`)))
          .when(!inEpic && children.length > 0, (el) => el.child(fold().ml(6))))
        .when(on, (el) => el.child(details()))
        .when(open, (el) => el.children(children.map((k, n) => row(k, [...lead, n === children.length - 1 ? "└" : "├"], indent, hide, inEpic))));
    };

    // Section headers as temporal.io labels: uppercase lavender with 0.8px letter spacing
    // (one box per character: elements have no letter spacing), then " · count".
    const label = (text) => h_flex().gap(0.8).children([...text.toUpperCase()].map((c) => div().flex_none().child(c === " " ? "\u00a0" : c)));
    const section = (id, title, list, body) => {
      if (!list.length) return [];
      const open = this.open.has(id);
      return [
        h_flex().id(`sec-${id}`).pl(10).pr(6).pt(8).h(z(28)).flex_none().gap(6).items_center().text_size(z(12)).font_medium()
          .on_click((_e, cx) => this.toggle(id, cx))
          .child(div().text_color(t.muted).child(label(title)))
          .child(div().text_color(t.dim).child(`· ${list.length}`))
          .child(div().flex_1())
          // The same chevron, in the same place, as an epic header's.
          .child(div().flex_none().p(3).text_color(t.dim).child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(z(12)))),
        ...(open ? body() : []),
      ];
    };

    const others = [...workers.entries()].filter(([term]) => term !== me?.address);
    const agentRows = () => others.flatMap(([term, list]) => {
      const a = live.get(term);
      return [
        h_flex().id(`bd-agent-${term}`).px(10).h(z(24)).flex_none().gap(6).items_center().text_size(z(11.5))
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().size(7).rounded(0).flex_none().bg(t[a.status] ?? t.dim))
          .child(div().truncate().text_color(t.foreground).child(`${a.space_name} · ${a.tab_name}`))
          .child(div().text_color(t.dim).child(term)),
        ...tops(list).sort(byPrio).map((i) => row(i, [], 12)),
      ];
    });

    // The open agent first: what it holds, or that it holds nothing.
    const meRows = !me ? [] : [
      h_flex().id("sec-me").px(10).pt(8).h(z(28)).flex_none().gap(6).items_center().text_size(z(12)).font_medium()
        .child(div().flex_none().text_color(t.muted).child(label("This agent")))
        .child(div().min_w(0).truncate().text_color(t.dim).child(`· ${me.address} · ${me.space_name}`)),
      ...(mine.length
        ? tops(mine).sort(byPrio).map((i) => row(i, [], 12))
        : [div().px(10).pb(2).text_size(z(11.5)).text_color(t.dim).child("This agent has claimed no beads.")]),
    ];
    const rows = [
      ...meRows,
      ...section("agents", "Other agents", others.map(([term]) => term), agentRows),
      ...section("progress", "In progress", progress, () => progress.map((i) => row(i, [], 0, above))),
      ...section("ready", "Ready", ready, () => ready.map((i) => row(i, [], 0, above))),
      ...section("other", "Open, waiting", other, () => other.map((i) => row(i, [], 0, above))),
    ];
    return shell(v_flex().id("bd-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar()
      .when(Boolean(this.error), (el) => el.child(div().px(10).text_size(z(11)).text_color(t.blocked).child(this.error)))
      .when(!this.issues.length && !this.error, (el) => el.child(div().px(10).text_size(z(12)).text_color(t.dim).child("No open beads.")))
      .children(rows));
  }
}
