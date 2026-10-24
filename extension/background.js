// SideSnip background (service worker in Chrome/Edge, event page in Firefox):
// toolbar/shortcut, install + data migration, and routing "Insert" to whichever frame
// holds the field the user last clicked.

const api = globalThis.browser ?? globalThis.chrome;

const KEY_ITEMS = 'sidesnip_items';
const KEY_GROUPS = 'sidesnip_groups';
const KEY_UI = 'sidesnip_ui';
const KEY_SITES = 'sidesnip_sites';
const DEFAULT_GROUPS = ['General', 'Work'];
const DEFAULT_TITLE = 'Turn on / collapse SideSnip on this site';
const SCRIPT_FILES = ['styles.js', 'content.js'];

const SEED = [
  { title: 'Welcome: click me to copy', content: 'Clicking a title copies its content. Use the ↵ button to type it straight into the field you last clicked. Edit or delete these examples and add your own with +.' },
  { title: 'LinkedIn URL', content: 'https://www.linkedin.com/in/your-name' },
  { title: 'Notice period', content: 'I am available to start with a 30-day notice period.' },
];

// Bring stored data up to the current shape. Safe to run repeatedly.
async function migrate(reason) {
  const data = await api.storage.local.get(null);
  const patch = {};

  let groups = Array.isArray(data[KEY_GROUPS]) && data[KEY_GROUPS].length ? data[KEY_GROUPS] : null;
  if (!groups) {
    groups = DEFAULT_GROUPS.map((name) => ({ id: crypto.randomUUID(), name }));
    patch[KEY_GROUPS] = groups;
  }
  const groupIds = new Set(groups.map((g) => g.id));

  const items = data[KEY_ITEMS];
  if (!Array.isArray(items)) {
    if (reason === 'install') patch[KEY_ITEMS] = SEED.map((it) => ({ id: crypto.randomUUID(), ...it, group: groups[0].id }));
  } else if (items.some((it) => !groupIds.has(it.group))) {
    // Snippets from before groups existed go into the first group.
    patch[KEY_ITEMS] = items.map((it) => (groupIds.has(it.group) ? it : { ...it, group: groups[0].id }));
  }

  if (!data[KEY_SITES]) patch[KEY_SITES] = { enabled: [], disabled: [] };
  if (!data[KEY_UI]) patch[KEY_UI] = { open: true };

  if (Object.keys(patch).length) await api.storage.local.set(patch);
}

api.runtime.onInstalled.addListener(async ({ reason }) => {
  await migrate(reason);
  // Inject into tabs that were already open so no page reload is needed.
  const tabs = await api.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: SCRIPT_FILES }).catch(() => {});
  }
});

// Toolbar icon and keyboard shortcut: turn SideSnip on for this site (or open / collapse it).
// If the tab has no live panel script (opened before install, or the extension was reloaded),
// inject one on the spot. If the browser forbids extensions there, say so on the icon.
async function showInTab(tab) {
  if (tab?.id == null) return;
  const ask = (type) => api.tabs.sendMessage(tab.id, { type }, { frameId: 0 });
  try {
    if ((await ask('ss-toggle'))?.ok) return;
  } catch {}
  try {
    await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: SCRIPT_FILES });
    if ((await ask('ss-show'))?.ok) return;
  } catch {}
  await flagUnavailable(tab.id);
}

async function flagUnavailable(tabId) {
  try {
    await api.action.setBadgeBackgroundColor({ tabId, color: '#ff3b30' });
    await api.action.setBadgeText({ tabId, text: '!' });
    await api.action.setTitle({ tabId, title: "SideSnip can't run on this page: browsers block extensions on new-tab, settings, add-on store and PDF pages." });
  } catch {}
  setTimeout(() => {
    api.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    api.action.setTitle({ tabId, title: DEFAULT_TITLE }).catch(() => {});
  }, 4000);
}

api.action.onClicked.addListener(showInTab);
api.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-panel') showInTab(tab);
});

// Runs in the page's own JS world (scripting world: 'MAIN'), so the page can read the dropped
// file: Firefox hides DataTransfer items an extension adds from the page's scripts.
async function replayDrop(x, y, name, type, base64) {
  let el = document.elementFromPoint(x, y);
  if (!el) return 'none';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], name, { type: type || 'application/octet-stream' }));
  const fire = (target, t) => target.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: dt }));
  fire(el, 'dragenter');
  fire(el, 'dragover');
  // Sites like Gmail only show their "Drop files here" layer once a file drag enters; give it a
  // moment to appear, then aim at whatever is under the pointer now.
  await new Promise((r) => setTimeout(r, 80));
  const now = document.elementFromPoint(x, y);
  if (now && now !== el) {
    fire(el, 'dragleave');
    el = now;
    fire(el, 'dragenter');
  }
  if (fire(el, 'dragover')) {
    fire(el, 'dragleave'); // nothing there accepts files
    return 'refused';
  }
  fire(el, 'drop');
  return 'dropped';
}

const FILE_PREFIX = 'sidesnip_file_';
const frameKey = (tabId) => `frame_${tabId}`;
const CLIPBOARD_PERMISSION = { permissions: ['clipboardRead'] };
const reply = (promise, sendResponse, fallback) => {
  promise.then((value) => sendResponse(value), () => sendResponse(fallback));
  return true; // keep the channel open for the async response
};

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // From grant.html (the clipboard-permission window): hand the answer back to the tab that asked.
  if (msg?.type === 'ss-clip-result') {
    setTimeout(() => {
      api.tabs.sendMessage(msg.tabId, { type: 'ss-clip-continue', granted: !!msg.granted }, { frameId: 0 }).catch(() => {});
    }, 350); // let the permission window close so the page has focus again
    return;
  }

  const tabId = sender.tab?.id;
  if (tabId == null) return;

  if (msg?.type === 'ss-clip-status') {
    return reply(api.permissions.contains(CLIPBOARD_PERMISSION).then((granted) => ({ granted })), sendResponse, { granted: false });
  }

  if (msg?.type === 'ss-clip-ask') {
    // Content scripts can't request permissions, so open a tiny extension window that can.
    const url = api.runtime.getURL(`grant.html?tab=${tabId}`);
    return reply(api.windows.create({ url, type: 'popup', width: 440, height: 290, focused: true }).then(() => ({ ok: true })), sendResponse, { ok: false });
  }

  if (msg?.type === 'ss-file-targets') {
    // Every upload field on the page, in every frame (each frame reports its own).
    const scan = api.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (typeof window.__sidesnipFileTargets === 'function' ? window.__sidesnipFileTargets() : []),
    });
    return reply(
      scan.then((results) => ({
        targets: results
          .flatMap((r) =>
            (Array.isArray(r.result) ? r.result : []).map((t) => ({ ...t, frameId: r.frameId, detail: r.frameId ? `${t.detail} · in an embedded form` : t.detail }))
          )
          // Fields you can see on the page first; hidden helper inputs (like Gmail's) last.
          .sort((a, b) => b.visible - a.visible || a.frameId - b.frameId || a.i - b.i),
      })),
      sendResponse,
      { targets: [] }
    );
  }

  if (msg?.type === 'ss-file-highlight') {
    const run = api.scripting.executeScript({
      target: { tabId, frameIds: [msg.frameId] },
      func: (index) => (typeof window.__sidesnipHighlight === 'function' ? window.__sidesnipHighlight(index) : false),
      args: [msg.index],
    });
    return reply(run.then(() => ({ ok: true })), sendResponse, { ok: false });
  }

  if (msg?.type === 'ss-file-attach') {
    const run = api.scripting.executeScript({
      target: { tabId, frameIds: [msg.frameId] },
      func: (index, fileId) => (typeof window.__sidesnipAttach === 'function' ? window.__sidesnipAttach(index, fileId) : { ok: false }),
      args: [msg.index, msg.fileId],
    });
    return reply(run.then((results) => results?.[0]?.result ?? { ok: false }), sendResponse, { ok: false });
  }

  if (msg?.type === 'ss-file-drop') {
    const key = FILE_PREFIX + msg.fileId;
    const run = api.storage.local.get(key).then((data) => {
      const rec = data[key];
      if (!rec?.data) return { result: 'none' };
      return api.scripting
        .executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func: replayDrop, args: [msg.x, msg.y, rec.name, rec.type, rec.data] })
        .then((results) => ({ result: results?.[0]?.result ?? 'none' }));
    });
    return reply(run, sendResponse, { result: 'none' });
  }

  if (msg?.type === 'ss-open') {
    // Web links only. Opened by the extension, not the page, so the site gets no opener or referrer.
    let url = null;
    try {
      url = new URL(msg.url);
    } catch {}
    if (!url || !/^https?:$/.test(url.protocol)) return reply(Promise.resolve({ ok: false }), sendResponse, { ok: false });
    const open = api.tabs.create({ url: url.href, index: sender.tab.index + 1, openerTabId: tabId });
    return reply(open.then(() => ({ ok: true })), sendResponse, { ok: false });
  }

  if (msg?.type === 'ss-focus') {
    api.storage.session.set({ [frameKey(tabId)]: sender.frameId ?? 0 });
    return;
  }

  if (msg?.type === 'ss-insert') {
    (async () => {
      const key = frameKey(tabId);
      const frameId = (await api.storage.session.get(key))[key] ?? 0;
      try {
        const res = await api.tabs.sendMessage(tabId, { type: 'ss-do-insert', text: msg.text }, { frameId });
        sendResponse(res ?? { ok: false });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true; // keep the channel open for the async response
  }
});

api.tabs.onRemoved.addListener((tabId) => api.storage.session.remove(frameKey(tabId)));
