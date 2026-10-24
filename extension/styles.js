// Panel styles, kept as a string so they can live inside the panel's Shadow DOM
// (isolated from the host page in both directions).
var SIDESNIP_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }

.dock {
  --bg: rgba(236, 240, 247, 0.42);
  --sheen: linear-gradient(160deg, rgba(255, 255, 255, 0.38), rgba(255, 255, 255, 0.04) 45%, rgba(255, 255, 255, 0.16));
  --grain: 1;
  --bg-strong: rgba(255, 255, 255, 0.82);
  --menu-bg: #ffffff;
  --border: rgba(255, 255, 255, 0.65);
  --edge: rgba(0, 0, 0, 0.06);
  --fg: #1d1d1f;
  --muted: rgba(29, 29, 31, 0.6);
  --hover: rgba(0, 0, 0, 0.085);
  --hover-strong: rgba(0, 0, 0, 0.14);
  --accent: #0a84ff;
  --tag: #0062cc;
  --ok: rgba(52, 199, 89, 0.3);
  --bad: rgba(255, 59, 48, 0.24);
  --danger: #ff3b30;
  --shadow: 0 12px 40px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.06);
  --highlight: inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 0 0 1px rgba(255, 255, 255, 0.2);

  color-scheme: light;
  position: fixed;
  z-index: 2147483647;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}
/* Dark theme: chosen in settings, or "Auto" on a dark page. */
.dock[data-theme="dark"] {
  --bg: rgba(44, 46, 54, 0.46);
  --sheen: linear-gradient(160deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0) 45%, rgba(255, 255, 255, 0.05));
  --grain: 0.8;
  --bg-strong: rgba(48, 48, 54, 0.9);
  --menu-bg: #2c2c31;
  --border: rgba(255, 255, 255, 0.17);
  --edge: rgba(255, 255, 255, 0.08);
  --fg: #f5f5f7;
  --muted: rgba(245, 245, 247, 0.64);
  --hover: rgba(255, 255, 255, 0.1);
  --hover-strong: rgba(255, 255, 255, 0.18);
  --tag: #8cc8ff;
  --shadow: 0 12px 40px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2);
  --highlight: inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  color-scheme: dark;
}

/* Frosted glass: a lighter tint and less blur than before so the page shows through, plus a cool tint, a sheen and
   grain (.grain) so it still reads as frosted over a plain white or plain dark page, where blur has nothing to show. */
.glass {
  background: var(--sheen), var(--bg);
  -webkit-backdrop-filter: blur(18px) saturate(170%);
  backdrop-filter: blur(18px) saturate(170%);
  border: 1px solid var(--border);
  box-shadow: var(--shadow), var(--highlight);
}
/* backdrop-filter makes .panel a stacking context, so z-index -1 keeps the grain above the tint but under the content. */
.grain {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  opacity: var(--grain);
  pointer-events: none;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  margin: 0;
  padding: 0;
  cursor: pointer;
}
button:disabled { opacity: 0.35; cursor: default; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex: none;
}

/* ---------- Placement ---------- */
.pill, .panel { position: absolute; top: 0; right: 0; }
.dock[data-side="left"] .pill,
.dock[data-side="left"] .panel { right: auto; left: 0; }
.dock[data-anchor="bottom"] .panel { top: auto; bottom: 0; }

.dock.dragging .pill,
.dock.dragging .panel {
  top: 0 !important;
  left: 0 !important;
  right: auto !important;
  bottom: auto !important;
  transition: none !important;
}
.dock.dragging .panel { border-radius: 20px; border-width: 1px; }
.dock.dragging, .dock.dragging * { cursor: grabbing !important; user-select: none; }

.ghost {
  position: fixed;
  display: none;
  pointer-events: none;
  border: 2px dashed var(--accent);
  background: rgba(10, 132, 255, 0.1);
  border-radius: 20px;
  transition: left 0.12s ease, top 0.12s ease, width 0.12s ease, height 0.12s ease;
}
.ghost.show { display: block; }

/* ---------- Floating pill (collapsed, not docked) ---------- */
.pill {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  display: grid;
  place-items: center;
  color: var(--fg);
  cursor: grab;
  touch-action: none;
  transition: opacity 0.18s ease, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.pill svg { width: 20px; height: 20px; }
.pill:hover { transform: scale(1.06); }
.dock.open .pill, .dock.docked .pill { opacity: 0; transform: scale(0.6); pointer-events: none; }

/* ---------- Panel ---------- */
.panel {
  width: 300px;
  max-height: 80vh;
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform-origin: top right;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: scale(0.9);
  transition: opacity 0.18s ease, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s linear 0.25s;
}
.dock[data-side="left"] .panel { transform-origin: top left; }
.dock.open .panel, .dock.docked .panel {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: none;
  transition: opacity 0.18s ease, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s;
}
.dock[data-anchor="top"] .panel { border-radius: 0 0 20px 20px; border-top-width: 0; }
.dock[data-anchor="bottom"] .panel { border-radius: 20px 20px 0 0; border-bottom-width: 0; }
.panel.filedrop { box-shadow: var(--shadow), inset 0 0 0 2px var(--accent); }
.panel.filedrop::after {
  content: "Drop to save as a snippet";
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border-radius: inherit;
  background: rgba(10, 132, 255, 0.14);
  color: var(--accent);
  font-weight: 700;
  pointer-events: none;
}

/* Accordion body: fully open, or folded down to just the header when docked + collapsed. */
.body {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  flex: 1 1 auto;
  min-height: 0;
  transition: grid-template-rows 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dock.docked:not(.open) .body { grid-template-rows: minmax(0, 0fr); }
.body-inner {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.head {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 9px 8px 9px 14px;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.brand {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.count { font-weight: 500; font-size: 12px; color: var(--muted); }

.ic {
  width: 27px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: var(--muted);
  flex: none;
}
.ic:hover { background: var(--hover); color: var(--fg); }
.ic.on { color: var(--accent); background: var(--hover); }
.ic.del.confirm { background: var(--danger); color: #fff; }
.collapse svg { transition: transform 0.25s ease; }
.dock[data-side="left"][data-anchor="float"] .collapse svg { transform: rotate(180deg); }
.dock[data-anchor="top"].open .collapse svg,
.dock[data-anchor="bottom"]:not(.open) .collapse svg { transform: rotate(-90deg); }
.dock[data-anchor="top"]:not(.open) .collapse svg,
.dock[data-anchor="bottom"].open .collapse svg { transform: rotate(90deg); }

.searchbar { display: flex; align-items: center; gap: 2px; margin: 0 6px 6px 10px; }
.search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 10px;
  background: var(--edge);
  color: var(--muted);
  cursor: text;
}
.search svg { width: 14px; height: 14px; }
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none !important;
  background: none;
  font: inherit;
  color: var(--fg);
  padding: 0;
}
.search input::placeholder { color: var(--muted); }

/* ---------- Group chips ---------- */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 8px 6px 10px;
}
.chip {
  flex: none;
  max-width: 100%;
  height: 24px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  background: var(--edge);
}
.chip:hover { color: var(--fg); background: var(--hover-strong); }
.chip.on { background: var(--accent); color: #fff; }
.chip.confirm { background: var(--danger); color: #fff; }
.chip.drop { box-shadow: inset 0 0 0 2px var(--accent); color: var(--fg); }
.chip-label {
  height: 24px;
  max-width: 210px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip-x + .chip-label, .chip-label:has(+ .chip-x) { padding-right: 2px; }
.chip-x {
  width: 18px;
  height: 18px;
  margin-right: 3px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: inherit;
  opacity: 0.85;
}
.chip-x:hover { opacity: 1; background: rgba(255, 255, 255, 0.25); }
.chip-x svg { width: 11px; height: 11px; stroke-width: 2.6; }
.chip.add { width: 22px; justify-content: center; }
.chip.add svg { width: 13px; height: 13px; }
.chip-input {
  flex: none;
  width: 120px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--accent);
  background: var(--bg-strong);
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  outline: none;
}

/* ---------- Snippet list ---------- */
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 6px 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--edge) transparent;
}
.row {
  display: flex;
  align-items: center;
  border-radius: 12px;
  padding: 0 4px 0 0;
  transition: background 0.15s ease;
}
.row:hover { background: var(--hover); }
.row.copied { background: var(--ok); }
.row.failed { background: var(--bad); }
.row.dragging { opacity: 0.4; }
.row.drop-before { box-shadow: inset 0 2px 0 var(--accent); }
.row.drop-after { box-shadow: inset 0 -2px 0 var(--accent); }
.grip {
  width: 16px;
  align-self: stretch;
  display: grid;
  place-items: center;
  color: var(--muted);
  cursor: grab;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.grip svg { width: 12px; height: 12px; }
.row:hover .grip { opacity: 0.7; }
.thumb {
  width: 30px;
  height: 30px;
  flex: none;
  margin-left: 2px;
  border-radius: 7px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--edge);
  color: var(--muted);
}
.row.nogrip .thumb { margin-left: 8px; }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  text-align: left;
  padding: 8px 6px 8px 2px;
  border-radius: 10px;
}
.thumb + .main { padding-left: 8px; }
.row.nogrip .main { padding-left: 10px; }
.row.nogrip .thumb + .main { padding-left: 8px; }
.t, .p { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.t { font-weight: 600; }
.p { font-size: 12px; color: var(--muted); }
.tag { color: var(--tag); font-weight: 600; }
.acts { display: flex; gap: 1px; opacity: 0; transition: opacity 0.15s ease; }
.row:hover .acts, .row:focus-within .acts { opacity: 1; }

/* Picking several snippets: each row becomes a toggle with a round check, and a bar sits under the list. */
.pickrow { width: 100%; padding: 0 4px 0 8px; text-align: left; }
.pickrow .thumb { margin-left: 0; }
.pickrow .main { padding-left: 8px; }
.check {
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  box-shadow: inset 0 0 0 1.5px var(--muted);
  color: transparent;
}
.check svg { width: 11px; height: 11px; stroke-width: 3; }
.pickrow.picked { background: var(--hover); }
.pickrow.picked .check { background: var(--accent); box-shadow: none; color: #fff; }
.selbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px 8px 14px;
  border-top: 1px solid var(--edge);
}
.sel-count { flex: 1; min-width: 0; font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.selbar .tbtn { padding: 0 8px; }
.selbar .tbtn.danger:not(:disabled) { color: var(--danger); }
.selbar .tbtn.danger.confirm { background: var(--danger); color: #fff; }
.empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 12px 20px;
  text-align: center;
  color: var(--muted);
}
.empty strong { color: var(--fg); font-weight: 600; }

/* "Attach to which upload field?" picker under a file snippet */
.picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 2px 4px 6px;
  padding: 8px;
  border-radius: 12px;
  background: var(--edge);
}
.pick {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bg-strong);
  text-align: left;
}
.pick:hover { box-shadow: inset 0 0 0 1.5px var(--accent); }
.pick-label, .pick-detail { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pick-label { font-size: 12px; font-weight: 600; }
.pick-detail { font-size: 11px; color: var(--muted); }
.picker .tbtn { align-self: flex-end; }

/* ---------- Add / edit form ---------- */
.form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 2px 10px 8px;
  padding: 8px;
  border-radius: 14px;
  background: var(--edge);
}
.list .form { margin: 4px 0; }
.form input, .form textarea, .form select, .grow input {
  width: 100%;
  font: inherit;
  color: var(--fg);
  background: var(--bg-strong);
  border: 1px solid var(--edge);
  border-radius: 9px;
  padding: 7px 9px;
  outline: none;
}
.form input { font-weight: 600; }
.form select { padding: 5px 7px; font-size: 12px; }
.form option { background: var(--menu-bg); color: var(--fg); }
/* Native select arrows ignore the panel theme in some browsers (Opera), so draw our own. */
.select-wrap { position: relative; display: block; }
.select-wrap select { -webkit-appearance: none; appearance: none; padding-right: 28px; cursor: pointer; }
.select-wrap svg {
  position: absolute;
  right: 9px;
  top: 50%;
  width: 13px;
  height: 13px;
  transform: translateY(-50%) rotate(90deg);
  color: var(--muted);
  pointer-events: none;
}
.form textarea { resize: vertical; min-height: 72px; max-height: 40vh; }
.form input:focus, .form textarea:focus, .form select:focus, .grow input:focus { border-color: var(--accent); }
.form input.invalid { border-color: var(--danger); }
.form-actions { display: flex; align-items: center; gap: 2px; }
.form-actions .spacer { flex: 1; }
.fchip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 4px 7px 9px;
  border-radius: 9px;
  background: var(--bg-strong);
  border: 1px solid var(--edge);
}
.fchip > svg { color: var(--muted); }
.fname { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fsize { font-size: 11px; color: var(--muted); white-space: nowrap; }

.tbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
}
.tbtn svg { width: 14px; height: 14px; }
.tbtn:hover { background: var(--hover); color: var(--fg); }
.tbtn.primary { background: var(--accent); color: #fff; }
.tbtn.primary:hover { filter: brightness(1.08); }
.tbtn.danger:hover { color: var(--danger); }
.tbtn .site { overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
.hint { font-size: 11px; color: var(--muted); }

/* ---------- Settings view ---------- */
.settings {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  scrollbar-width: thin;
  scrollbar-color: var(--edge) transparent;
}
.set-title {
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.set-sec .hint { margin-top: 5px; }
.posmap {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: repeat(3, 26px);
  gap: 2px;
  padding: 4px;
  border-radius: 12px;
  border: 1px solid var(--edge);
  background: var(--edge);
}
.pos { display: flex; align-items: center; padding: 0 6px; border-radius: 8px; }
.pos:hover { background: var(--hover); }
.pos.right { justify-content: flex-end; }
.pos.top { align-items: flex-start; padding-top: 2px; }
.pos.bottom { align-items: flex-end; padding-bottom: 2px; }
.pos-shape { background: var(--muted); opacity: 0.5; }
.pos.top .pos-shape, .pos.bottom .pos-shape { width: 44px; height: 7px; border-radius: 3px; }
.pos.float .pos-shape { width: 12px; height: 12px; border-radius: 50%; }
.pos.on .pos-shape { background: var(--accent); opacity: 1; }
.seg { display: flex; padding: 2px; border-radius: 10px; background: var(--edge); }
.seg button {
  flex: 1;
  height: 26px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.seg button.on { background: var(--bg-strong); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
.grow { display: flex; align-items: center; gap: 4px; margin: 0 0 4px -6px; border-radius: 8px; }
.grow .grip { width: 14px; height: 30px; opacity: 0.45; }
.grow:hover .grip { opacity: 0.8; }
.grow.dragging { opacity: 0.4; }
.grow.drop-before { box-shadow: 0 -2px 0 var(--accent); }
.grow.drop-after { box-shadow: 0 2px 0 var(--accent); }
.grow input { flex: 1; min-width: 0; height: 30px; padding: 0 9px; border-radius: 8px; }
.grow input[readonly] { color: var(--muted); }
.gcount { min-width: 18px; text-align: right; font-size: 11px; color: var(--muted); }
.set-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.set-foot { display: flex; align-items: center; justify-content: space-between; padding-top: 10px; border-top: 1px solid var(--edge); }
.set-foot a { text-decoration: none; }

.toast {
  position: absolute;
  left: 50%;
  bottom: 14px;
  max-width: 270px;
  padding: 7px 14px;
  border-radius: 999px;
  background: var(--bg-strong);
  box-shadow: var(--shadow);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, 6px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; }
}
`;
