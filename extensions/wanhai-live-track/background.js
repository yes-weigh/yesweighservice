/* Background: queue pending Wan Hai track jobs from the Yes Weigh app. */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;

  if (message.type === 'YW_WANHAI_QUEUE') {
    const job = {
      purchaseOrderId: String(message.purchaseOrderId || '').trim(),
      containerNumber: String(message.containerNumber || '').trim().toUpperCase(),
      blNumber: String(message.blNumber || '').trim().toUpperCase(),
      queuedAt: Date.now(),
    };
    if (!job.purchaseOrderId || !job.containerNumber) {
      sendResponse({ ok: false, error: 'Missing purchase order or container.' });
      return true;
    }
    chrome.storage.local.set({ ywWanHaiJob: job }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'YW_WANHAI_GET_JOB') {
    chrome.storage.local.get(['ywWanHaiJob'], (data) => {
      sendResponse({ ok: true, job: data.ywWanHaiJob || null });
    });
    return true;
  }

  if (message.type === 'YW_WANHAI_CLEAR_JOB') {
    chrome.storage.local.remove(['ywWanHaiJob'], () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'YW_WANHAI_RESULT') {
    const payload = message.payload || {};
    chrome.tabs.query({}, (tabs) => {
      const appTabs = tabs.filter((tab) => {
        const url = String(tab.url || '');
        return (
          url.includes('service.yesweigh.in')
          || url.includes('yesweigh-service.web.app')
          || url.includes('yesweigh-service.firebaseapp.com')
          || url.includes('localhost:5173')
          || url.includes('localhost:5174')
          || url.includes('127.0.0.1:5173')
          || url.includes('127.0.0.1:5174')
        );
      });
      for (const tab of appTabs) {
        if (tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: 'YW_WANHAI_RESULT_TO_APP',
          payload,
        }).catch(() => {});
      }
      chrome.storage.local.remove(['ywWanHaiJob']);
      sendResponse({ ok: true, delivered: appTabs.length });
    });
    return true;
  }

  return undefined;
});
