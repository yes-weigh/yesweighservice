/* Bridge Yes Weigh app page ↔ extension background. */

function postToPage(detail) {
  window.dispatchEvent(new CustomEvent('YesWeighWanHaiExtension', { detail }));
}

window.addEventListener('YesWeighWanHaiTrackRequest', (event) => {
  const detail = event && event.detail ? event.detail : {};
  chrome.runtime.sendMessage(
    {
      type: 'YW_WANHAI_QUEUE',
      purchaseOrderId: detail.purchaseOrderId,
      containerNumber: detail.containerNumber,
      blNumber: detail.blNumber,
    },
    (response) => {
      postToPage({
        type: 'queued',
        ok: Boolean(response && response.ok),
        error: response && response.error ? response.error : null,
        extensionInstalled: true,
      });
    },
  );
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'YW_WANHAI_RESULT_TO_APP') return;
  postToPage({
    type: 'result',
    payload: message.payload || null,
  });
});

// Let the app know the extension is present.
postToPage({ type: 'ready', extensionInstalled: true });
