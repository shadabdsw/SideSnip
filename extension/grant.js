// Asks for the optional clipboardRead permission (only extension pages can), then tells the
// tab that asked so it can finish "Add copied text".
const api = globalThis.browser ?? globalThis.chrome;
const tabId = Number(new URLSearchParams(location.search).get('tab'));

function finish(granted) {
  api.runtime
    .sendMessage({ type: 'ss-clip-result', tabId, granted })
    .catch(() => {})
    .finally(() => window.close());
}

document.getElementById('allow').addEventListener('click', () => {
  // Must be called straight from the click (Firefox rejects it after an await).
  api.permissions.request({ permissions: ['clipboardRead'] }).then(finish, () => finish(false));
});
document.getElementById('cancel').addEventListener('click', () => finish(false));
