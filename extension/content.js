// SideSnip content script.
// Every frame: remembers the last editable field the user focused, can insert text into it,
// and can put a stored file into an upload field.
// Top frame only: renders the floating glass panel (closed Shadow DOM) on sites where it's turned on.
(() => {
  if (window.__sidesnipAlive?.()) return;
  const api = globalThis.browser ?? globalThis.chrome;
  const alive = () => {
    try {
      return !!api.runtime?.id;
    } catch {
      return false;
    }
  };
  window.__sidesnipAlive = alive;

  const send = (msg) => {
    if (!alive()) return Promise.resolve(null);
    try {
      return api.runtime.sendMessage(msg).then((res) => res ?? null, () => null);
    } catch {
      return Promise.resolve(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Field tracking + insert (all frames)
  // ---------------------------------------------------------------------------
  const TEXT_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url', 'search', 'number', 'password']);
  const TEMP_ATTR = 'data-sidesnip-temp'; // our own throwaway textareas (clipboard helpers)
  let lastField = null;
  let host = null; // panel host element (top frame only)

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(el.type);
  }

  document.addEventListener(
    'focusin',
    (e) => {
      const path = e.composedPath();
      if (host && path.includes(host)) return;
      const el = path[0];
      if (!isEditable(el) || el.hasAttribute(TEMP_ATTR)) return;
      lastField = el;
      send({ type: 'ss-focus' });
    },
    true
  );

  function insertText(el, text) {
    if (!el || !el.isConnected) return false;
    if (el.ownerDocument.activeElement !== el) el.focus({ preventScroll: true });

    if (el.isContentEditable) {
      try {
        return document.execCommand('insertText', false, text);
      } catch {
        return false;
      }
    }

    // execCommand keeps native undo and fires real input events that React/Angular/Vue pick up.
    const before = el.value;
    try {
      if (document.execCommand('insertText', false, text) && el.value !== before) return true;
    } catch {}

    // Fallback: set through the native setter so framework-controlled inputs notice the change.
    let start = el.value.length;
    let end = start;
    try {
      if (el.selectionStart != null) {
        start = el.selectionStart;
        end = el.selectionEnd;
      }
    } catch {}
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, el.value.slice(0, start) + text + el.value.slice(end));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Where the cursor is right now (looking inside open shadow roots of page widgets).
  function activeField() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return isEditable(el) ? el : null;
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Prefer the field that has the cursor now (panel clicks don't move focus), then the last one
    // we saw get focus. The first covers fields focused before this script loaded (autofocus).
    if (msg?.type === 'ss-do-insert') sendResponse({ ok: insertText(activeField() ?? lastField, msg.text) });
  });

  // ---------------------------------------------------------------------------
  // File snippets (all frames): put a stored file into a page's upload field
  // ---------------------------------------------------------------------------
  const FILE_PREFIX = 'sidesnip_file_';
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const fileInputs = () => [...document.querySelectorAll('input[type="file"]')].filter((el) => !el.disabled);
  const LABELISH = 'label, legend, h1, h2, h3, h4, h5, h6, [class*="label" i], [class*="title" i]';
  // Field names that say nothing to a person (Gmail's hidden inputs are all "Filedata").
  const GENERIC_NAMES = /^(file|files|filedata|fileinput|fileupload|upload|uploads|uploadfile|attach|attachment|attachments|document|documents|myfile|userfile|qqfile|input|data)\d*$/;

  // "Images", "PDF, DOC, DOCX", "Any file"… from an input's accept attribute.
  function describeAccept(accept) {
    const parts = (accept || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return 'Any file';
    if (parts.every((p) => p.startsWith('image/') || /^\.(png|jpe?g|gif|webp|heic|bmp|svg)$/.test(p))) return 'Images';
    const nameOf = (p) =>
      p.startsWith('.') ? p.slice(1).toUpperCase() : p.endsWith('/*') ? `${p[0].toUpperCase()}${p.slice(1, -2)}s` : p === 'application/pdf' ? 'PDF' : p.includes('word') ? 'DOC' : p.split('/').pop().toUpperCase();
    const names = [...new Set(parts.map(nameOf))];
    return names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : names.join(', ');
  }

  // A human name for an upload field: its label, the nearest label/heading before it (only for
  // fields on screen: hidden helper inputs sit next to unrelated text), a meaningful name
  // attribute, or else what kind of file it takes.
  function uploadLabel(el, visible) {
    const fit = (t) => (t && t.length <= 60 ? t : '');
    let text =
      fit(clean(el.getAttribute('aria-label'))) ||
      fit(clean(el.labels?.[0]?.textContent)) ||
      fit(clean((el.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '))) ||
      fit(clean(el.title));
    for (let node = el, depth = 0; visible && !text && node && depth < 5; node = node.parentElement, depth++) {
      for (let sib = node.previousElementSibling, k = 0; !text && sib && k < 4; sib = sib.previousElementSibling, k++) {
        // Look inside a sibling only if it's label-sized; a big block's first heading is someone else's.
        const lab = sib.matches(LABELISH) ? sib : clean(sib.textContent).length <= 80 ? sib.querySelector(LABELISH) : null;
        if (lab) text = fit(clean(lab.textContent));
      }
    }
    if (!text) {
      const name = clean((el.name || el.id || '').replace(/[_\-[\]]+/g, ' '));
      if (name && !GENERIC_NAMES.test(name.toLowerCase().replace(/[^a-z0-9]/g, ''))) text = name;
    }
    if (!text) {
      const kind = describeAccept(el.accept);
      text = kind === 'Any file' ? 'File upload' : kind === 'Images' ? 'Image upload' : `${kind} upload`;
    }
    return text.length > 40 ? `${text.slice(0, 39)}…` : text;
  }

  function isShown(node) {
    const r = node.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.right + scrollX <= 0 || r.bottom + scrollY <= 0) return false;
    const cs = getComputedStyle(node);
    return cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
  }

  // What the user sees for an upload field: the input itself, its label, or the box around a hidden
  // input (drop zones). null when the field isn't on screen at all.
  function visibleProxy(el) {
    if (isShown(el)) return el;
    const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    if (byFor && isShown(byFor)) return byFor;
    for (let node = el.parentElement, depth = 0; node && node !== document.body && depth < 3; node = node.parentElement, depth++) {
      if (isShown(node)) return node;
    }
    return null;
  }

  // Outline an upload field on the page while its option is hovered in the attach picker.
  let highlightBox = null;
  function highlightTarget(index) {
    highlightBox?.remove();
    highlightBox = null;
    const el = index >= 0 ? fileInputs()[index] : null;
    const proxy = el && visibleProxy(el);
    if (!proxy) return false;
    let r = proxy.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) {
      proxy.scrollIntoView({ block: 'center' });
      r = proxy.getBoundingClientRect();
    }
    highlightBox = document.createElement('div');
    highlightBox.setAttribute('data-sidesnip-highlight', '');
    for (const [prop, value] of Object.entries({
      all: 'initial',
      position: 'fixed',
      left: `${r.left - 4}px`,
      top: `${r.top - 4}px`,
      width: `${r.width + 8}px`,
      height: `${r.height + 8}px`,
      border: '2px solid #0a84ff',
      'border-radius': '8px',
      background: 'rgba(10, 132, 255, 0.08)',
      'box-shadow': '0 0 0 4px rgba(10, 132, 255, 0.25)',
      'box-sizing': 'border-box',
      'pointer-events': 'none',
      'z-index': '2147483646',
    })) {
      highlightBox.style.setProperty(prop, value, 'important');
    }
    document.documentElement.append(highlightBox);
    return true;
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function loadFile(id) {
    const key = FILE_PREFIX + id;
    const rec = (await api.storage.local.get(key))[key];
    if (!rec?.data) return null;
    return new File([base64ToBytes(rec.data)], rec.name, { type: rec.type || 'application/octet-stream' });
  }

  async function attachFile(index, fileId) {
    const el = fileInputs()[index];
    const file = el && (await loadFile(fileId));
    if (!file) return { ok: false };
    try {
      putFileInInput(el, file);
    } catch {
      return { ok: false };
    }
    return { ok: true };
  }

  function putFileInInput(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Called by background.js through scripting.executeScript (same isolated world).
  window.__sidesnipFileTargets = () =>
    fileInputs().map((el, i) => {
      const visible = !!visibleProxy(el);
      const detail = [describeAccept(el.accept), el.multiple ? 'multiple' : '', visible ? '' : 'not visible on the page'].filter(Boolean).join(' · ');
      return { i, label: uploadLabel(el, visible), detail, visible };
    });
  window.__sidesnipAttach = (index, fileId) => attachFile(index, fileId);
  window.__sidesnipHighlight = (index) => highlightTarget(index);

  // ---------------------------------------------------------------------------
  // Panel (top frame only)
  // ---------------------------------------------------------------------------
  if (window !== window.top || !(document.documentElement instanceof HTMLElement)) return;

  const K = { items: 'sidesnip_items', groups: 'sidesnip_groups', ui: 'sidesnip_ui', sites: 'sidesnip_sites' };
  const SITE = location.hostname || location.protocol;
  const REPO_URL = 'https://github.com/shadabdsw/sidesnip';
  const NOGROUP = 'nogroup';
  const NOGROUP_NAME = '(No group)';
  const MAX_FILE = 10 * 1024 * 1024;
  const DEFAULT_UI = { open: false, side: 'right', anchor: 'float', top: 0.18, theme: 'auto', group: 'all', everywhere: false };
  const PANEL_W = 300;
  const SNAP = 56; // px from the top/bottom edge at which a dragged panel docks to the corner

  let items = [];
  let groups = [];
  let ui = { ...DEFAULT_UI };
  let sites = { enabled: [], disabled: [] };
  let query = '';
  let view = 'list'; // 'list' | 'settings'
  let editing = null; // null | 'new' | item id
  let draft = null; // prefill for a new snippet, e.g. { content } from the clipboard
  let formApi = null; // the open add/edit form, so clipboard text can be dropped into it
  let attaching = null; // { id, targets } while choosing an upload field for a file snippet
  let dragId = null; // snippet being dragged
  let moving = false; // panel being dragged
  let pageDark = false;
  const fileCache = new Map(); // id -> Promise<File|null>
  const fileReady = new Map(); // id -> File (for synchronous use in dragstart)
  const thumbs = new Map(); // id -> object URL

  const uid = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
  const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), Math.max(lo, hi));
  const short = (s, n = 28) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const preview = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 120) || '(empty)';
  const arr = (v) => (Array.isArray(v) ? v : []);
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  const isFile = (it) => it.kind === 'file' && !!it.file;
  const isImage = (it) => isFile(it) && /^image\//.test(it.file.type || '');
  const formatSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const fileKind = (f) => ((f.name.includes('.') ? f.name.split('.').pop() : (f.type || '').split('/').pop()) || 'file').toUpperCase().slice(0, 5);
  const fileMeta = (f) => ({ name: f.name, type: f.type, size: f.size });
  const baseName = (name) => name.replace(/\.[^.]+$/, '') || name;
  // Only keep known fields (older versions stored `hidden` / `glass`).
  const sanitizeUI = (v) => {
    v = v || {};
    return {
      open: typeof v.open === 'boolean' ? v.open : DEFAULT_UI.open,
      side: pick(v.side, ['left', 'right'], DEFAULT_UI.side),
      anchor: pick(v.anchor, ['float', 'top', 'bottom'], DEFAULT_UI.anchor),
      top: Number.isFinite(v.top) ? clamp(v.top, 0, 1) : DEFAULT_UI.top,
      theme: pick(v.theme, ['auto', 'light', 'dark'], DEFAULT_UI.theme),
      group: typeof v.group === 'string' ? v.group : DEFAULT_UI.group,
      everywhere: v.everywhere === true,
    };
  };
  const sanitizeSites = (v) => ({ enabled: arr(v?.enabled), disabled: arr(v?.disabled) });
  const enabledHere = () => (ui.everywhere ? !sites.disabled.includes(SITE) : sites.enabled.includes(SITE));
  const viewport = () => {
    const standards = document.compatMode === 'CSS1Compat';
    const de = document.documentElement;
    return { w: standards ? de.clientWidth : innerWidth, h: standards ? de.clientHeight : innerHeight };
  };
  const groupOf = (it) => (groups.some((g) => g.id === it.group) ? it.group : groups[0]?.id ?? '');
  const groupName = (id) => groups.find((g) => g.id === id)?.name ?? '';
  const groupCount = (id) => items.filter((it) => groupOf(it) === id).length;
  const currentGroup = () => (groups.some((g) => g.id === ui.group) ? ui.group : 'all');
  const targetGroup = () => (currentGroup() !== 'all' ? currentGroup() : groups[0]?.id ?? '');

  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CLIPBOARD = [
    ['rect', { x: 8, y: 2, width: 8, height: 4, rx: 1 }],
    ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }],
  ];
  const ICONS = {
    // The SideSnip mark: a window with a panel docked on its right side (same shape as the toolbar icon).
    logo: [
      ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }],
      ['path', { d: 'M14 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4z', fill: 'currentColor' }],
    ],
    clipPlus: [...CLIPBOARD, ['path', { d: 'M9 14h6M12 11v6' }]],
    plus: [['path', { d: 'M12 5v14M5 12h14' }]],
    x: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
    chevron: [['path', { d: 'm9 18 6-6-6-6' }]],
    sliders: [['path', { d: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4' }]],
    search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm20 20-3.5-3.5' }]],
    insert: [['path', { d: 'M20 4v7a4 4 0 0 1-4 4H4' }], ['path', { d: 'm9 10-5 5 5 5' }]],
    paperclip: [['path', { d: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48' }]],
    file: [['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }], ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }]],
    image: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ['circle', { cx: 9, cy: 9, r: 2 }], ['path', { d: 'm21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21' }]],
    pencil: [['path', { d: 'M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }]],
    trash: [
      ['path', { d: 'M3 6h18' }],
      ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
      ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
    ],
    eyeOff: [
      ['path', { d: 'M10.73 5.08A10.74 10.74 0 0 1 21.94 11.65a1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49' }],
      ['path', { d: 'M14.08 14.16a3 3 0 0 1-4.24-4.24' }],
      ['path', { d: 'M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14' }],
      ['path', { d: 'm2 2 20 20' }],
    ],
    down: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['path', { d: 'm7 10 5 5 5-5M12 15V3' }]],
    github: [
      ['path', { d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4' }],
      ['path', { d: 'M9 18c-4.51 2-5-2-7-2' }],
    ],
    up: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['path', { d: 'm17 8-5-5-5 5M12 3v12' }]],
    grip: [5, 12, 19].flatMap((y) => [
      ['circle', { cx: 9, cy: y, r: 1.6, fill: 'currentColor', stroke: 'none' }],
      ['circle', { cx: 15, cy: y, r: 1.6, fill: 'currentColor', stroke: 'none' }],
    ]),
  };

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of ICONS[name]) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      svg.append(node);
    }
    return svg;
  }

  // Frost grain drawn by an inline SVG filter rather than a data: URL background, which a strict page CSP (img-src) would block.
  // It is what makes the glass read as frosted over a plain white or plain dark page, where blur alone has nothing to show.
  function grain() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'grain');
    svg.setAttribute('aria-hidden', 'true');
    const node = (tag, attrs, ...kids) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      el.append(...kids);
      return el;
    };
    svg.append(
      node('filter', { id: 'ss-grain', x: '0', y: '0', width: '100%', height: '100%' },
        node('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: '2', stitchTiles: 'stitch' }),
        node('feColorMatrix', { values: '0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.1 0' })),
      node('rect', { width: '100%', height: '100%', filter: 'url(#ss-grain)' })
    );
    return svg;
  }

  // --- Build DOM -------------------------------------------------------------
  document.querySelectorAll('sidesnip-root').forEach((n) => n.remove()); // stale copy from a reloaded extension
  host = document.createElement('sidesnip-root');
  // !important so aggressive page CSS (e.g. `* { display: none !important }`) can't hide the panel.
  for (const [prop, value] of Object.entries({
    all: 'initial',
    display: 'block',
    position: 'fixed',
    top: '0',
    right: '0',
    width: '0',
    height: '0',
    'z-index': '2147483647',
  })) {
    host.style.setProperty(prop, value, 'important');
  }
  const shadow = host.attachShadow({ mode: 'closed' });
  let styled = false;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(SIDESNIP_CSS);
    shadow.adoptedStyleSheets = [sheet];
    styled = shadow.adoptedStyleSheets.length === 1;
  } catch {}
  if (!styled) shadow.append(h('style', { text: SIDESNIP_CSS }));

  const countEl = h('span', { class: 'count' });
  const gearBtn = h(
    'button',
    { class: 'ic', title: 'Settings: position, theme, groups, backup', 'aria-label': 'Settings', onclick: () => setView(view === 'settings' ? 'list' : 'settings') },
    icon('sliders')
  );
  const collapseBtn = h('button', { class: 'ic collapse', title: 'Collapse', 'aria-label': 'Collapse', onclick: () => setUI({ open: !ui.open }) }, icon('chevron'));
  const head = h(
    'div',
    { class: 'head', title: 'Click to collapse or expand · drag to any edge or corner' },
    h('div', { class: 'brand' }, icon('logo'), h('span', { text: 'SideSnip' }), countEl),
    h('button', { class: 'ic', title: 'New snippet (text or file)', 'aria-label': 'New snippet', onclick: () => startEdit('new') }, icon('plus')),
    h('button', { class: 'ic', title: 'New snippet from copied text', 'aria-label': 'New snippet from copied text', onclick: pasteFromClipboard }, icon('clipPlus')),
    h(
      'button',
      { class: 'ic', title: 'Turn off on this site (the toolbar icon brings it back)', 'aria-label': 'Turn off on this site', onclick: () => setSiteEnabled(false) },
      icon('eyeOff')
    ),
    gearBtn,
    collapseBtn
  );

  const searchInput = h('input', { type: 'text', placeholder: 'Search all groups', spellcheck: 'false', 'aria-label': 'Search snippets' });
  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim().toLowerCase();
    attaching = null;
    renderList();
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) {
      searchInput.value = '';
      query = '';
      renderList();
    }
  });
  const search = h('label', { class: 'search' }, icon('search'), searchInput);
  const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Groups' });
  const formSlot = h('div');
  const list = h('div', { class: 'list' });
  const settingsBox = h('div', { class: 'settings' });
  const importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, class: 'import-pick' });
  const bodyInner = h('div', { class: 'body-inner' });
  const toast = h('div', { class: 'toast', role: 'status' });
  const panel = h('div', { class: 'panel glass', role: 'dialog', 'aria-label': 'SideSnip' }, grain(), head, h('div', { class: 'body' }, bodyInner), toast);
  const pill = h('button', { class: 'pill glass', title: 'Open SideSnip (Alt+Shift+K) · drag to move', 'aria-label': 'Open SideSnip' }, icon('logo'));
  const ghost = h('div', { class: 'ghost' });
  const dock = h('div', { class: 'dock' }, ghost, pill, panel, importInput);
  shadow.append(dock);

  // Keep focus in the page's form field when clicking panel buttons, so Ctrl+V works
  // right after a copy and "Insert" knows where to type.
  shadow.addEventListener('mousedown', (e) => {
    const t = e.composedPath()[0];
    if (t === list || t === settingsBox || t.closest?.('input, textarea, select, .grip, label.search')) return;
    e.preventDefault();
  });
  // Don't let typing in the panel trigger the page's keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) shadow.addEventListener(type, (e) => e.stopPropagation());

  // Drop files (a resume, an image…) from the desktop onto the panel to save them as snippets.
  const hasFiles = (e) => !dragId && [...(e.dataTransfer?.types ?? [])].includes('Files');
  panel.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    panel.classList.add('filedrop');
  });
  panel.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !panel.contains(e.relatedTarget)) panel.classList.remove('filedrop');
  });
  panel.addEventListener('drop', (e) => {
    panel.classList.remove('filedrop');
    if (!hasFiles(e)) return;
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
  });

  // --- Rendering -------------------------------------------------------------
  function render() {
    gearBtn.classList.toggle('on', view === 'settings');
    formApi = null;
    if (view === 'settings') {
      bodyInner.replaceChildren(settingsBox);
      renderSettings();
    } else {
      bodyInner.replaceChildren(search, chips, formSlot, list);
      renderChips();
      renderForm();
      renderList();
    }
  }

  // Re-render after a change from storage (another tab, or our own write echoing back)
  // without wiping anything the user is typing.
  function refresh() {
    if (view === 'settings') {
      if (shadow.activeElement?.tagName !== 'INPUT') renderSettings();
      return;
    }
    if (shadow.activeElement?.classList.contains('chip-input')) return;
    renderChips();
    if (!editing) renderList();
  }

  function setView(next) {
    view = next;
    attaching = null;
    if (!ui.open) setUI({ open: true });
    render();
  }

  function renderChips() {
    const cur = currentGroup();
    const chip = (id, name) => {
      const on = cur === id;
      const label = h('button', {
        class: 'chip-label',
        role: 'tab',
        'aria-selected': String(on),
        title: id === 'all' ? 'All snippets' : `${name} · drop a snippet here to move it`,
        text: name,
        onclick: () => setUI({ group: id }),
      });
      const wrap = h('span', { class: `chip${on ? ' on' : ''}` }, label);
      // The selected group can be deleted right here (except a non-empty "(No group)").
      if (on && id !== 'all' && !(id === NOGROUP && groupCount(id) > 0)) {
        const xTitle = `Delete group “${name}”`;
        let timer;
        const x = h(
          'button',
          {
            class: 'chip-x',
            title: xTitle,
            'aria-label': xTitle,
            onclick: () => {
              if (wrap.classList.contains('confirm')) {
                clearTimeout(timer);
                deleteGroup(id);
                return;
              }
              wrap.classList.add('confirm');
              label.textContent = 'Delete?';
              x.title = 'Click × again to delete this group';
              timer = setTimeout(() => {
                wrap.classList.remove('confirm');
                label.textContent = name;
                x.title = xTitle;
              }, 2500);
            },
          },
          icon('x')
        );
        wrap.append(x);
      }
      if (id !== 'all') {
        wrap.addEventListener('dragover', (e) => {
          if (!dragId) return;
          e.preventDefault();
          wrap.classList.add('drop');
        });
        wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
        wrap.addEventListener('drop', (e) => {
          if (!dragId) return;
          e.preventDefault();
          wrap.classList.remove('drop');
          moveToGroup(dragId, id);
        });
      }
      return wrap;
    };
    const addChip = h('button', { class: 'chip add', title: 'New group', 'aria-label': 'New group', onclick: () => quickAddGroup(addChip) }, icon('plus'));
    chips.replaceChildren(chip('all', 'All'), ...groups.map((g) => chip(g.id, g.name)), addChip);
  }

  function quickAddGroup(addChip) {
    const input = h('input', { class: 'chip-input', placeholder: 'Group name', maxlength: '40', 'aria-label': 'New group name' });
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name) {
        const g = { id: uid(), name };
        groups = [...groups, g];
        saveGroups();
        setUI({ group: g.id });
      }
      renderChips();
      renderList();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    addChip.replaceWith(input);
    input.focus();
  }

  function renderForm() {
    formSlot.replaceChildren(...(editing === 'new' ? [buildForm(null)] : []));
  }

  function matches(it) {
    return `${it.title}\n${isFile(it) ? it.file.name : it.content}`.toLowerCase().includes(query);
  }

  function renderList() {
    const cur = currentGroup();
    const inView = cur === 'all' ? items : items.filter((it) => groupOf(it) === cur);
    const shown = query ? items.filter(matches) : inView;
    countEl.textContent = items.length ? String(shown.length) : '';
    if (!items.length) {
      list.replaceChildren(
        h(
          'div',
          { class: 'empty' },
          h('strong', { text: 'No snippets yet' }),
          h('span', { text: 'Click + to add one, 📋 to save what you copied, or drop a file (like your resume) here.' })
        )
      );
    } else if (!shown.length && query) {
      list.replaceChildren(h('div', { class: 'empty', text: 'No matches' }));
    } else if (!shown.length) {
      list.replaceChildren(
        h('div', { class: 'empty' }, h('strong', { text: `Nothing in “${groupName(cur)}” yet` }), h('span', { text: 'Click + to add a snippet here, or drag one from “All” onto this group.' }))
      );
    } else {
      const showGroup = (!!query || cur === 'all') && groups.length > 1;
      const nodes = [];
      for (const it of shown) {
        if (editing === it.id) {
          nodes.push(buildForm(it));
          continue;
        }
        nodes.push(buildRow(it, { reorderable: !query, showGroup }));
        if (attaching?.id === it.id) nodes.push(buildPicker(it));
      }
      list.replaceChildren(...nodes);
    }
  }

  function confirmButton(title, onConfirm) {
    let timer;
    const btn = h(
      'button',
      {
        class: 'ic del',
        title,
        'aria-label': title,
        onclick: () => {
          if (btn.classList.contains('confirm')) {
            clearTimeout(timer);
            onConfirm();
            return;
          }
          btn.classList.add('confirm');
          btn.title = 'Click again to confirm';
          timer = setTimeout(() => {
            btn.classList.remove('confirm');
            btn.title = title;
          }, 2500);
        },
      },
      icon('trash')
    );
    return btn;
  }

  function buildThumb(it) {
    const box = h('span', { class: 'thumb' });
    if (!isImage(it)) {
      box.append(icon('file'));
      return box;
    }
    const img = h('img', { alt: '' });
    img.addEventListener('error', () => img.replaceWith(icon('image')));
    box.append(img);
    thumbUrl(it.id).then((url) => (url ? (img.src = url) : img.replaceWith(icon('image'))));
    return box;
  }

  function buildRow(it, { reorderable, showGroup }) {
    const file = isFile(it);
    const row = h('div', { class: reorderable ? 'row' : 'row nogrip' });
    const tag = showGroup ? h('span', { class: 'tag', text: `${groupName(groupOf(it))} · ` }) : null;
    const main = h(
      'button',
      {
        class: 'main',
        title: file ? (isImage(it) ? 'Click to copy the image' : 'Click to attach to an upload field on this page') : 'Click to copy',
        onclick: () => (file ? (isImage(it) ? copyImage(it, row) : startAttach(it)) : copyItem(it, row)),
      },
      h('span', { class: 't', text: it.title }),
      h('span', { class: 'p' }, tag, file ? `${fileKind(it.file)} · ${formatSize(it.file.size)}` : preview(it.content))
    );
    const acts = h(
      'div',
      { class: 'acts' },
      file
        ? h('button', { class: 'ic', title: 'Attach to an upload field on this page', 'aria-label': 'Attach', onclick: () => startAttach(it) }, icon('paperclip'))
        : h('button', { class: 'ic', title: 'Type into the last field you clicked', 'aria-label': 'Insert', onclick: () => insertItem(it, row) }, icon('insert')),
      h('button', { class: 'ic', title: 'Edit', 'aria-label': 'Edit', onclick: () => startEdit(it.id) }, icon('pencil')),
      confirmButton('Delete', () => deleteItem(it))
    );

    if (reorderable) {
      row.draggable = true;
      row.append(
        h('span', { class: 'grip', title: file ? 'Drag onto an upload area to attach, or to reorder' : 'Drag to reorder, onto a group to move it, or onto a form field' }, icon('grip'))
      );
      row.addEventListener('dragstart', (e) => {
        dragId = it.id;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'copyMove';
        if (!file) e.dataTransfer.setData('text/plain', it.content); // dropping onto a page field inserts the content
        // Files: a private type only. Chromium turns a page-made File into its name as text (which
        // Gmail's editor happily pastes), so the file is delivered on release instead (dragend).
        else e.dataTransfer.setData('application/x-sidesnip-file', it.id);
      });
      row.addEventListener('dragend', (e) => {
        dragId = null;
        row.classList.remove('dragging');
        clearDropMarks();
        if (file) dropFileAt(it, e);
      });
      row.addEventListener('dragover', (e) => {
        if (!dragId || dragId === it.id) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        clearDropMarks();
        row.classList.add(after ? 'drop-after' : 'drop-before');
      });
      row.addEventListener('drop', (e) => {
        if (!dragId || dragId === it.id) return;
        e.preventDefault();
        moveItem(dragId, it.id, row.classList.contains('drop-after'));
      });
    }
    // Load file bytes ahead of time so a drag can carry the file right away.
    if (file) row.addEventListener('pointerenter', () => getFile(it.id));

    row.append(...(file ? [buildThumb(it)] : []), main, acts);
    return row;
  }

  function buildPicker(it) {
    const seen = new Map();
    const labelOf = (t) => {
      const n = (seen.get(t.label) ?? 0) + 1;
      seen.set(t.label, n);
      return n > 1 ? `${t.label} (${n})` : t.label;
    };
    return h(
      'div',
      { class: 'picker' },
      h('div', { class: 'hint', text: `Attach “${short(it.title, 24)}” to (hover to see it on the page):` }),
      ...attaching.targets.map((t) => {
        const label = labelOf(t);
        return h(
          'button',
          {
            class: 'pick',
            title: `${label} · ${t.detail}`,
            onclick: () => doAttach(it, t),
            onpointerenter: () => highlight(t),
            onpointerleave: () => highlight(null),
          },
          h('span', { class: 'pick-label', text: label }),
          h('span', { class: 'pick-detail', text: t.detail })
        );
      }),
      h('button', {
        class: 'tbtn',
        text: 'Cancel',
        onclick: () => {
          attaching = null;
          highlight(null);
          renderList();
        },
      })
    );
  }

  // Outline the hovered upload field on the page (in whichever frame it lives).
  let highlighted = null;
  function highlight(target) {
    if (highlighted) send({ type: 'ss-file-highlight', frameId: highlighted.frameId, index: -1 });
    highlighted = target;
    if (target) send({ type: 'ss-file-highlight', frameId: target.frameId, index: target.i });
  }

  function clearDropMarks() {
    shadow.querySelectorAll('.drop-before, .drop-after, .chip.drop').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop'));
  }

  function moveItem(fromId, toId, after) {
    const next = items.slice();
    const [moved] = next.splice(next.findIndex((x) => x.id === fromId), 1);
    next.splice(next.findIndex((x) => x.id === toId) + (after ? 1 : 0), 0, moved);
    items = next;
    saveItems();
    renderList();
  }

  function moveToGroup(itemId, groupId) {
    const it = items.find((x) => x.id === itemId);
    if (!it || groupOf(it) === groupId) return;
    items = items.map((x) => (x.id === itemId ? { ...x, group: groupId } : x));
    saveItems();
    renderChips();
    renderList();
    showToast(`Moved “${short(it.title, 20)}” to ${short(groupName(groupId), 18)}`);
  }

  function deleteItem(it) {
    items = items.filter((x) => x.id !== it.id);
    if (isFile(it)) forgetFile(it.id, true);
    saveItems();
    renderChips();
    renderList();
  }

  function buildForm(item) {
    let fileMetaNow = item && isFile(item) ? item.file : null; // file already stored for this snippet
    let pending = null; // newly chosen File, saved on Save
    const titleIn = h('input', { type: 'text', placeholder: 'Title, e.g. LinkedIn URL', maxlength: '120', 'aria-label': 'Title' });
    const contentIn = h('textarea', { rows: '4', placeholder: 'Content that gets copied', 'aria-label': 'Content' });
    const groupIn = h('select', { 'aria-label': 'Group', title: 'Group' }, ...groups.map((g) => h('option', { value: g.id, text: g.name })));
    const filePick = h('input', { type: 'file', hidden: true, class: 'file-pick' });
    const bodySlot = h('div');
    titleIn.value = item?.title ?? '';
    contentIn.value = (item && !isFile(item) ? item.content : draft?.content) ?? '';
    groupIn.value = item ? groupOf(item) : targetGroup();

    const paintBody = () => {
      const meta = pending ? fileMeta(pending) : fileMetaNow;
      if (!meta) {
        bodySlot.replaceChildren(contentIn);
        return;
      }
      bodySlot.replaceChildren(
        h(
          'div',
          { class: 'fchip' },
          icon(/^image\//.test(meta.type) ? 'image' : 'file'),
          h('span', { class: 'fname', title: meta.name, text: meta.name }),
          h('span', { class: 'fsize', text: formatSize(meta.size) }),
          h(
            'button',
            {
              class: 'ic',
              title: 'Remove the file (make this a text snippet)',
              'aria-label': 'Remove file',
              onclick: () => {
                pending = null;
                fileMetaNow = null;
                paintBody();
              },
            },
            icon('x')
          )
        )
      );
    };
    filePick.addEventListener('change', () => {
      const f = filePick.files?.[0];
      filePick.value = '';
      if (!f) return;
      if (f.size > MAX_FILE) return showToast(`“${short(f.name)}” is over 10 MB`);
      pending = f;
      if (!titleIn.value.trim()) titleIn.value = baseName(f.name);
      paintBody();
    });
    paintBody();

    const save = async () => {
      const title = titleIn.value.trim();
      if (!title) {
        titleIn.classList.add('invalid');
        titleIn.focus();
        return;
      }
      const group = groupIn.value || targetGroup();
      const id = item?.id ?? uid();
      let next;
      if (pending) {
        if (!(await storeFile(id, pending))) return;
        next = { id, kind: 'file', title, group, file: fileMeta(pending) };
      } else if (fileMetaNow) {
        next = { id, kind: 'file', title, group, file: fileMetaNow };
      } else {
        next = { id, title, content: contentIn.value, group };
        if (item && isFile(item)) forgetFile(id, true);
      }
      items = item ? items.map((x) => (x.id === id ? next : x)) : [...items, next];
      editing = null;
      draft = null;
      saveItems();
      render();
      if (!item) list.scrollTop = list.scrollHeight;
    };
    const cancel = () => {
      editing = null;
      draft = null;
      render();
    };

    const form = h(
      'div',
      {
        class: 'form',
        onkeydown: (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          } else if (e.key === 'Enter' && e.target === titleIn) {
            e.preventDefault();
            (bodySlot.contains(contentIn) ? contentIn : titleIn).focus();
          }
        },
      },
      titleIn,
      bodySlot,
      groups.length > 1 ? h('span', { class: 'select-wrap' }, groupIn, icon('chevron')) : null,
      filePick,
      h(
        'div',
        { class: 'form-actions' },
        h('button', { class: 'ic', title: 'Use the text you last copied', 'aria-label': 'Paste copied text', onclick: pasteFromClipboard }, icon('clipPlus')),
        h('button', { class: 'ic', title: 'Attach a file or image (up to 10 MB)', 'aria-label': 'Attach file', onclick: () => filePick.click() }, icon('paperclip')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'tbtn', text: 'Cancel', onclick: cancel }),
        h('button', { class: 'tbtn primary', text: 'Save', title: 'Save (Ctrl+Enter)', onclick: save })
      )
    );
    formApi = {
      setText(text) {
        pending = null;
        fileMetaNow = null;
        paintBody();
        contentIn.value = text;
        (titleIn.value.trim() ? contentIn : titleIn).focus({ preventScroll: true });
      },
    };
    const focusTarget = !item && draft && !draft.content ? contentIn : titleIn;
    requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
    return form;
  }

  function startEdit(id) {
    view = 'list';
    attaching = null;
    editing = editing === id ? null : id;
    if (id === 'new' && !editing) draft = null;
    if (id === 'new' && query) {
      searchInput.value = '';
      query = '';
    }
    if (!ui.open) setUI({ open: true });
    render();
  }

  // --- Settings view ---------------------------------------------------------
  function renderSettings() {
    const section = (title, ...kids) => h('section', { class: 'set-sec' }, h('div', { class: 'set-title', text: title }), ...kids);
    const pos = (side, anchor, label) => {
      const on = ui.side === side && ui.anchor === anchor;
      return h(
        'button',
        { class: `pos ${side} ${anchor}${on ? ' on' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(on), onclick: () => setUI({ side, anchor }) },
        h('span', { class: 'pos-shape' })
      );
    };
    const seg = (options, value, onPick) =>
      h('div', { class: 'seg' }, ...options.map(([v, label]) => h('button', { class: v === value ? 'on' : '', 'aria-pressed': String(v === value), text: label, onclick: () => onPick(v) })));

    settingsBox.replaceChildren(
      section(
        'Position',
        h(
          'div',
          { class: 'posmap' },
          pos('left', 'top', 'Dock top-left'),
          pos('right', 'top', 'Dock top-right'),
          pos('left', 'float', 'Float on the left'),
          pos('right', 'float', 'Float on the right'),
          pos('left', 'bottom', 'Dock bottom-left'),
          pos('right', 'bottom', 'Dock bottom-right')
        ),
        h('div', { class: 'hint', text: 'Or drag the header to any edge or corner.' })
      ),
      section(
        'Theme',
        seg([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], ui.theme, (v) => setUI({ theme: v })),
        h('div', { class: 'hint', text: 'Auto matches the page you’re on.' })
      ),
      section(
        'Show SideSnip on',
        seg([['chosen', 'Sites I turn on'], ['all', 'Every site']], ui.everywhere ? 'all' : 'chosen', setShowOn),
        h('div', { class: 'hint', text: 'Turn it on for a site with the toolbar icon or Alt+Shift+K.' })
      ),
      section('Groups', ...groups.map(groupRow), h('button', { class: 'tbtn', onclick: addGroupFromSettings }, icon('plus'), 'New group')),
      section(
        'Backup',
        h(
          'div',
          { class: 'set-actions' },
          h('button', { class: 'tbtn', title: 'Save all snippets, files and groups to a JSON file', onclick: exportItems }, icon('down'), 'Export'),
          h('button', { class: 'tbtn', title: 'Add snippets from a JSON file', onclick: () => importInput.click() }, icon('up'), 'Import')
        )
      ),
      section(
        'This site',
        h('button', { class: 'tbtn danger', title: `Hide SideSnip on ${SITE}`, onclick: () => setSiteEnabled(false) }, icon('eyeOff'), h('span', { class: 'site', text: `Turn off on ${SITE}` }))
      ),
      h(
        'div',
        { class: 'set-foot' },
        h('span', { class: 'hint', text: `SideSnip ${api.runtime.getManifest().version}` }),
        h('a', { class: 'ic', href: REPO_URL, target: '_blank', rel: 'noopener noreferrer', title: 'SideSnip on GitHub', 'aria-label': 'SideSnip on GitHub' }, icon('github'))
      )
    );
  }

  function setShowOn(value) {
    // Whichever way you switch, keep the panel on the site you're looking at.
    setSiteEnabled(true);
    setUI({ everywhere: value === 'all' });
  }

  function groupRow(g) {
    const isNoGroup = g.id === NOGROUP;
    const input = h('input', { type: 'text', maxlength: '40', 'aria-label': 'Group name', readonly: isNoGroup, title: isNoGroup ? 'Holds snippets from deleted groups' : null });
    input.value = g.name;
    input.addEventListener('change', () => {
      const name = input.value.trim();
      if (!name) {
        input.value = g.name;
        return;
      }
      groups = groups.map((x) => (x.id === g.id ? { ...x, name } : x));
      saveGroups();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = g.name;
        input.blur();
      }
    });
    const count = groupCount(g.id);
    const del = confirmButton(`Delete group “${g.name}”`, () => deleteGroup(g.id));
    if (isNoGroup && count > 0) {
      del.disabled = true;
      del.title = 'Move or delete its snippets first';
    }
    return h('div', { class: 'grow' }, input, h('span', { class: 'gcount', title: plural(count, 'snippet'), text: String(count) }), del);
  }

  function addGroupFromSettings() {
    const names = new Set(groups.map((g) => g.name));
    let name = 'New group';
    for (let i = 2; names.has(name); i++) name = `New group ${i}`;
    groups = [...groups, { id: uid(), name }];
    saveGroups();
    renderSettings();
    const inputs = settingsBox.querySelectorAll('.grow input');
    inputs[inputs.length - 1]?.select();
  }

  // A deleted group's snippets move to "(No group)", which is created when first needed.
  function deleteGroup(id) {
    const affected = items.filter((it) => groupOf(it) === id);
    if (id === NOGROUP && affected.length) return;
    let next = groups.filter((g) => g.id !== id);
    if (affected.length) {
      if (!next.some((g) => g.id === NOGROUP)) next = [...next, { id: NOGROUP, name: NOGROUP_NAME }];
      items = items.map((it) => (groupOf(it) === id ? { ...it, group: NOGROUP } : it));
    }
    if (!next.length) next = [{ id: NOGROUP, name: NOGROUP_NAME }];
    groups = next;
    store({ [K.items]: items, [K.groups]: groups });
    if (ui.group === id) setUI({ group: 'all' });
    else if (view !== 'settings') {
      renderChips();
      renderList();
    }
    if (view === 'settings') renderSettings();
    showToast(affected.length ? `Moved ${plural(affected.length, 'snippet')} to ${NOGROUP_NAME}` : 'Group deleted');
  }

  // --- Files -----------------------------------------------------------------
  // FileReader (rather than file.arrayBuffer()) because Firefox won't let a content script view
  // the bytes of a page-owned buffer; a data: URL string crosses that boundary fine.
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function storeFile(id, file) {
    try {
      const data = await fileToBase64(file);
      await api.storage.local.set({ [FILE_PREFIX + id]: { ...fileMeta(file), data } });
    } catch {
      showToast('Couldn’t save that file');
      return false;
    }
    forgetFile(id, false);
    fileCache.set(id, Promise.resolve(file));
    fileReady.set(id, file);
    return true;
  }

  function forgetFile(id, removeData) {
    fileCache.delete(id);
    fileReady.delete(id);
    if (thumbs.has(id)) URL.revokeObjectURL(thumbs.get(id));
    thumbs.delete(id);
    if (removeData) api.storage.local.remove(FILE_PREFIX + id).catch(() => {});
  }

  function getFile(id) {
    if (!fileCache.has(id)) {
      fileCache.set(
        id,
        loadFile(id).then((f) => {
          if (f) fileReady.set(id, f);
          else fileCache.delete(id);
          return f;
        })
      );
    }
    return fileCache.get(id);
  }

  async function thumbUrl(id) {
    if (!thumbs.has(id)) {
      const f = await getFile(id);
      if (!f) return null;
      thumbs.set(id, URL.createObjectURL(f));
    }
    return thumbs.get(id);
  }

  async function addFiles(files) {
    const group = targetGroup();
    let added = 0;
    for (const f of files) {
      if (f.size > MAX_FILE) {
        showToast(`“${short(f.name)}” is over 10 MB`);
        continue;
      }
      const id = uid();
      if (!(await storeFile(id, f))) continue;
      items = [...items, { id, kind: 'file', title: baseName(f.name), group, file: fileMeta(f) }];
      added++;
    }
    if (!added) return;
    saveItems();
    if (!ui.open) setUI({ open: true });
    if (view === 'list' && !editing) {
      renderChips();
      renderList();
      list.scrollTop = list.scrollHeight;
    }
    showToast(`Saved ${plural(added, 'file')}`);
  }

  async function startAttach(it) {
    if (attaching?.id === it.id) {
      attaching = null;
      return renderList();
    }
    const res = await send({ type: 'ss-file-targets' });
    const targets = res?.targets ?? [];
    if (!targets.length) return showToast('No upload field here: drag the file onto the upload area');
    if (targets.length === 1) return doAttach(it, targets[0]);
    attaching = { id: it.id, targets };
    renderList();
  }

  async function doAttach(it, target) {
    highlight(null);
    const res = await send({ type: 'ss-file-attach', frameId: target.frameId, index: target.i, fileId: it.id });
    attaching = null;
    renderList();
    showToast(res?.ok ? `Attached to “${short(target.label, 22)}”` : 'Couldn’t attach here: drag the file onto the upload area');
  }

  // Delivers a file snippet to the spot where it was released: a bare upload input gets the file
  // directly; anything else gets a replayed dragenter/dragover/drop (see replayDrop in background.js).
  async function dropFileAt(it, e) {
    const x = e.clientX || e.screenX - (window.mozInnerScreenX ?? window.screenX);
    const y = e.clientY || e.screenY - (window.mozInnerScreenY ?? window.screenY);
    const el = document.elementFromPoint(x, y);
    if (!el || el === host || el === document.documentElement) return;
    if (el.tagName === 'IFRAME') return showToast('Use 📎 Attach for uploads inside this form');
    const done = () => showToast(`Dropped “${short(it.title, 22)}”`);
    const input = el.closest('input[type="file"]') ?? el.closest('label')?.querySelector('input[type="file"]');
    if (input) {
      const file = fileReady.get(it.id) ?? (await getFile(it.id));
      try {
        if (file) return putFileInInput(input, file), done();
      } catch {}
      return showToast('Couldn’t drop the file there: try 📎 Attach');
    }
    const res = await send({ type: 'ss-file-drop', x, y, fileId: it.id });
    if (res?.result === 'dropped') done();
    else if (res?.result === 'refused') showToast('That spot doesn’t take files: try 📎 Attach');
  }

  async function toPng(file) {
    const bmp = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  async function copyImage(it, row) {
    let ok = false;
    try {
      // Clipboards take PNG images; the promise keeps the click's permission to write while the file loads.
      const png = getFile(it.id).then((f) => (f.type === 'image/png' ? f : toPng(f)));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      ok = true;
    } catch {}
    flash(row, ok);
    showToast(ok ? `Copied image “${short(it.title)}”` : 'Couldn’t copy this image: drag it instead');
  }

  // --- Text actions ----------------------------------------------------------
  function tempTextarea(readonly) {
    const ta = document.createElement('textarea');
    ta.setAttribute(TEMP_ATTR, '');
    if (readonly) ta.setAttribute('readonly', '');
    Object.assign(ta.style, { position: 'fixed', top: '-1000px', left: '0', opacity: '0' });
    (document.body || document.documentElement).append(ta);
    return ta;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    // Fallback (e.g. focus is inside a cross-origin iframe, or the page blocks the Clipboard API).
    const prev = document.activeElement;
    const ta = tempTextarea(true);
    ta.value = text;
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    prev?.focus?.({ preventScroll: true });
    return ok;
  }

  // Needs the optional clipboardRead permission (asked for the first time "Add copied text" is used).
  async function readClipboard() {
    const prev = document.activeElement;
    const ta = tempTextarea(false);
    ta.focus();
    let text = '';
    try {
      if (document.execCommand('paste')) text = ta.value;
    } catch {}
    ta.remove();
    prev?.focus?.({ preventScroll: true });
    if (text) return text;
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  }

  async function pasteFromClipboard() {
    const status = await send({ type: 'ss-clip-status' });
    if (!status?.granted) {
      // First use: background opens a small SideSnip window that asks for clipboard access,
      // then calls back with 'ss-clip-continue'.
      if ((await send({ type: 'ss-clip-ask' }))?.ok) showToast('Allow clipboard access in the SideSnip window');
      else openWithText('');
      return;
    }
    openWithText(await readClipboard());
  }

  function openWithText(text) {
    if (formApi) formApi.setText(text);
    else {
      draft = { content: text };
      view = 'list';
      editing = 'new';
      attaching = null;
      if (query) {
        searchInput.value = '';
        query = '';
      }
      if (!ui.open) setUI({ open: true });
      render();
    }
    showToast(text ? 'Give it a title, then Save' : 'Paste your text with Ctrl+V');
  }

  async function copyItem(it, row) {
    const ok = await copyText(it.content);
    flash(row, ok);
    showToast(ok ? `Copied “${short(it.title)}”` : 'Copy was blocked here, try ↵ Insert');
  }

  async function insertItem(it, row) {
    if (!alive()) return showToast('SideSnip was updated, reload this page');
    const res = await send({ type: 'ss-insert', text: it.content });
    flash(row, !!res?.ok);
    showToast(res?.ok ? `Inserted “${short(it.title)}”` : 'Click into a form field first');
  }

  // --- Backup ----------------------------------------------------------------
  // Export keeps snippet order, each snippet's group (by name) and file contents.
  async function exportItems() {
    const keys = items.filter(isFile).map((it) => FILE_PREFIX + it.id);
    const files = keys.length ? await api.storage.local.get(keys) : {};
    const data = {
      app: 'sidesnip',
      version: 3,
      exportedAt: new Date().toISOString(),
      groups: groups.map((g) => g.name),
      items: items.map((it) =>
        isFile(it)
          ? { title: it.title, group: groupName(groupOf(it)), kind: 'file', file: files[FILE_PREFIX + it.id] ?? null }
          : { title: it.title, content: it.content, group: groupName(groupOf(it)) }
      ),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = h('a', { href: url, download: `sidesnip-${new Date().toISOString().slice(0, 10)}.json` });
    shadow.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast(`Exported ${plural(items.length, 'snippet')}`);
  }

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed?.items;
      if (!Array.isArray(incoming)) throw new Error('not a list');

      const nextGroups = groups.slice();
      const groupIdFor = (name) => {
        const cleanName = typeof name === 'string' ? name.trim() : '';
        if (!cleanName) return null;
        let g = nextGroups.find((x) => x.name.toLowerCase() === cleanName.toLowerCase());
        if (!g) nextGroups.push((g = { id: cleanName === NOGROUP_NAME ? NOGROUP : uid(), name: cleanName }));
        return g.id;
      };
      arr(parsed?.groups).forEach(groupIdFor); // keep empty groups from the backup too
      const fallbackGroup = targetGroup() || nextGroups[0]?.id || '';

      const keyOf = (x) => (isFile(x) ? `file\u0000${x.title}\u0000${x.file.name}\u0000${x.file.size}` : `${x.title}\u0000${x.content}`);
      const seen = new Set(items.map(keyOf));
      const added = [];
      const fileData = {};
      for (const x of incoming) {
        if (!x || typeof x.title !== 'string' || !x.title.trim()) continue;
        const id = uid();
        const group = groupIdFor(x.group) ?? fallbackGroup;
        let entry;
        if (x.kind === 'file') {
          const f = x.file;
          if (!f || typeof f.data !== 'string' || typeof f.name !== 'string') continue;
          entry = { id, kind: 'file', title: x.title.trim(), group, file: { name: f.name, type: f.type || '', size: f.size || 0 } };
          if (!seen.has(keyOf(entry))) fileData[FILE_PREFIX + id] = { name: f.name, type: f.type || '', size: f.size || 0, data: f.data };
        } else {
          entry = { id, title: x.title.trim(), content: typeof x.content === 'string' ? x.content : '', group };
        }
        if (seen.has(keyOf(entry))) continue;
        seen.add(keyOf(entry));
        added.push(entry);
      }
      if (Object.keys(fileData).length) await api.storage.local.set(fileData);
      groups = nextGroups;
      items = [...items, ...added];
      store({ [K.items]: items, [K.groups]: groups });
      render();
      showToast(`Imported ${plural(added.length, 'snippet')}`);
    } catch {
      showToast('That file isn’t a SideSnip backup');
    }
  });

  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function flash(row, ok) {
    const cls = ok ? 'copied' : 'failed';
    row.classList.remove('copied', 'failed');
    void row.offsetWidth; // restart the transition
    row.classList.add(cls);
    setTimeout(() => row.classList.remove(cls), 900);
  }

  // --- Theme -----------------------------------------------------------------
  // "Auto" follows the page: dark panel on dark pages, light panel on light pages.
  function detectPageDark() {
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (!m || m.length < 3) continue;
      const [r, g, b, a = 1] = m.map(Number);
      if (a < 0.5) continue;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
    }
    // Transparent page: the browser paints its canvas, which is dark only for dark color-schemes.
    const scheme = getComputedStyle(document.documentElement).colorScheme || '';
    if (!scheme.includes('dark')) return false;
    return !scheme.includes('light') || matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme() {
    if (ui.theme === 'auto') pageDark = detectPageDark();
    dock.dataset.theme = ui.theme === 'auto' ? (pageDark ? 'dark' : 'light') : ui.theme;
  }

  let themeQueued = false;
  function queueTheme() {
    if (themeQueued || ui.theme !== 'auto' || !host.isConnected) return;
    themeQueued = true;
    requestAnimationFrame(() => {
      themeQueued = false;
      applyTheme();
    });
  }
  const themeWatch = new MutationObserver(queueTheme);
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'dark'] });
  if (document.body) themeWatch.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', queueTheme);
  document.addEventListener('visibilitychange', queueTheme);

  // --- Visibility, position, collapse, drag ---------------------------------
  function syncMount() {
    const want = enabledHere();
    if (want && !host.isConnected) document.documentElement.append(host);
    else if (!want && host.isConnected) host.remove();
  }

  function setSiteEnabled(on) {
    const enabled = new Set(sites.enabled);
    const disabled = new Set(sites.disabled);
    if (on) {
      enabled.add(SITE);
      disabled.delete(SITE);
    } else {
      enabled.delete(SITE);
      disabled.add(SITE);
    }
    sites = { enabled: [...enabled], disabled: [...disabled] };
    applyUI();
    store({ [K.sites]: sites });
  }

  function place() {
    if (moving) return;
    const vp = viewport();
    const docked = ui.anchor !== 'float';
    panel.style.maxHeight = `${docked ? vp.h - 16 : Math.max(220, Math.min(vp.h * 0.8, vp.h - 32))}px`;
    dock.style.left = ui.side === 'left' ? '16px' : '';
    dock.style.right = ui.side === 'right' ? '16px' : '';
    dock.style.top = '';
    dock.style.bottom = '';
    if (ui.anchor === 'top') dock.style.top = '0px';
    else if (ui.anchor === 'bottom') dock.style.bottom = '0px';
    else {
      const height = ui.open ? panel.offsetHeight : pill.offsetHeight;
      dock.style.top = `${Math.round(clamp(ui.top * vp.h, 16, vp.h - height - 16))}px`;
    }
  }

  function applyUI() {
    syncMount();
    applyTheme();
    dock.dataset.side = ui.side;
    dock.dataset.anchor = ui.anchor;
    dock.classList.toggle('open', ui.open);
    dock.classList.toggle('docked', ui.anchor !== 'float');
    collapseBtn.title = ui.open ? 'Collapse' : 'Expand';
    place();
  }

  function setUI(patch) {
    const prevGroup = ui.group;
    ui = sanitizeUI({ ...ui, ...patch });
    applyUI();
    saveUI();
    if (view === 'settings') renderSettings();
    else if (ui.group !== prevGroup) {
      attaching = null;
      renderChips();
      renderList();
    }
  }

  // Where a panel dropped at (left, top) will land: a docked corner bar near the top/bottom
  // edge, otherwise floating on the nearer side.
  function snapFor(left, top, w, h, fromPill) {
    const vp = viewport();
    const side = left + w / 2 < vp.w / 2 ? 'left' : 'right';
    const anchor = top < SNAP ? 'top' : top + h > vp.h - SNAP ? 'bottom' : 'float';
    let gw = w;
    let gh = h;
    if (anchor !== 'float' && fromPill) {
      gw = PANEL_W; // the pill turns into a docked header bar
      gh = head.offsetHeight || 46;
    } else if (anchor === 'float' && !ui.open) {
      gw = gh = 44; // a collapsed bar turns back into the pill
    }
    const x = side === 'left' ? 16 : vp.w - gw - 16;
    const y = anchor === 'top' ? 0 : anchor === 'bottom' ? vp.h - gh : clamp(top, 16, vp.h - gh - 16);
    const radius = anchor === 'top' ? '0 0 20px 20px' : anchor === 'bottom' ? '20px 20px 0 0' : gw === 44 ? '22px' : '20px';
    return { side, anchor, top: anchor === 'float' ? y / vp.h : ui.top, ghost: { x, y, w: gw, h: gh, radius } };
  }

  function makeDraggable(handle, onTap) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const btn = e.target.closest?.('button');
      if (btn && btn !== handle) return; // let header buttons do their own thing
      const el = handle === pill ? pill : panel;
      const r = el.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, w: r.width, h: r.height };
      let snap = null;
      handle.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moving && Math.hypot(dx, dy) < 5) return;
        moving = true;
        dock.classList.add('dragging');
        const vp = viewport();
        const left = clamp(start.left + dx, 0, vp.w - start.w);
        const top = clamp(start.top + dy, 0, vp.h - start.h);
        Object.assign(dock.style, { left: `${left}px`, top: `${top}px`, right: '', bottom: '' });
        snap = snapFor(left, top, start.w, start.h, el === pill);
        Object.assign(ghost.style, {
          left: `${snap.ghost.x}px`,
          top: `${snap.ghost.y}px`,
          width: `${snap.ghost.w}px`,
          height: `${snap.ghost.h}px`,
          borderRadius: snap.ghost.radius,
        });
        ghost.classList.add('show');
      };
      const onUp = (ev) => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        if (moving) {
          moving = false;
          dock.classList.remove('dragging');
          ghost.classList.remove('show');
          if (snap) setUI({ side: snap.side, anchor: snap.anchor, top: snap.top });
          else place();
        } else if (ev.type === 'pointerup') {
          onTap();
        }
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }
  makeDraggable(pill, () => setUI({ open: true }));
  makeDraggable(head, () => setUI({ open: !ui.open }));
  pill.addEventListener('click', (e) => {
    if (e.detail === 0) setUI({ open: true }); // keyboard activation (Enter / Space)
  });

  window.addEventListener('resize', place);
  new ResizeObserver(place).observe(panel);

  // --- Storage ---------------------------------------------------------------
  function store(obj) {
    if (!alive()) return showToast('SideSnip was updated, reload this page');
    api.storage.local.set(obj).catch(() => {});
  }
  const saveItems = () => store({ [K.items]: items });
  const saveGroups = () => store({ [K.groups]: groups });
  const saveUI = () => store({ [K.ui]: ui });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let dirty = false;
    if (changes[K.items]) {
      items = arr(changes[K.items].newValue);
      dirty = true;
    }
    if (changes[K.groups]) {
      groups = arr(changes[K.groups].newValue);
      dirty = true;
    }
    if (changes[K.sites]) sites = sanitizeSites(changes[K.sites].newValue);
    if (changes[K.ui]) {
      const prevGroup = ui.group;
      ui = sanitizeUI(changes[K.ui].newValue);
      if (ui.group !== prevGroup || view === 'settings') dirty = true;
    }
    if (changes[K.ui] || changes[K.sites]) applyUI();
    if (dirty) refresh();
  });

  // Messages from background.js (sent to the top frame only).
  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ss-toggle' || msg?.type === 'ss-show') {
      // Toolbar icon / shortcut.
      ready.then(() => {
        const wasOff = !enabledHere();
        if (wasOff) setSiteEnabled(true);
        setUI({ open: wasOff || msg.type === 'ss-show' ? true : !ui.open });
        sendResponse({ ok: true });
      });
      return true;
    }
    if (msg?.type === 'ss-clip-continue') {
      // The clipboard-permission window finished.
      ready.then(async () => openWithText(msg.granted ? await readClipboard() : ''));
    }
  });

  const ready = api.storage.local.get([K.items, K.groups, K.ui, K.sites]).then((data) => {
    items = arr(data[K.items]);
    groups = arr(data[K.groups]);
    ui = sanitizeUI(data[K.ui]);
    sites = sanitizeSites(data[K.sites]);
    // Some single-page apps rebuild the document; put the panel back if it gets removed.
    new MutationObserver(() => {
      if (!host.isConnected && enabledHere() && alive()) document.documentElement.append(host);
    }).observe(document.documentElement, { childList: true });
    render();
    applyUI();
  });
})();
