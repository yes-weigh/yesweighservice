/* Wan Hai only: after CAPTCHA, fill Ctnr No., Query, scrape list, send to Yes Weigh. */

const CAPTCHA_HINTS = /hcaptcha|additional security check|i am human|imperva/i;
const QUERY_PATH = /cargo_track_v2\/tracking_query/i;
const LIST_PATH = /cargo_track_v2\/tracking_ctnr_list|tracking_.*list/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pageHasCaptcha() {
  const text = document.body ? document.body.innerText : '';
  if (CAPTCHA_HINTS.test(text)) return true;
  if (document.querySelector('iframe[src*="hcaptcha"], iframe[src*="captcha"]')) return true;
  return false;
}

function visible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findQueryButton() {
  const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
  return buttons.find((el) => {
    const label = `${el.value || ''} ${el.textContent || ''}`.trim();
    return /^query$/i.test(label) || /\bquery\b/i.test(label);
  }) || null;
}

function selectContainerSearchType() {
  const selects = Array.from(document.querySelectorAll('select'));
  for (const select of selects) {
    const options = Array.from(select.options || []);
    const ctnr = options.find((opt) => /ctnr|container/i.test(opt.textContent || ''));
    if (ctnr) {
      select.value = ctnr.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }

  const clickables = Array.from(document.querySelectorAll('li, label, span, div, a'));
  const ctnrItem = clickables.find((el) => {
    const t = (el.textContent || '').trim();
    return /^ctnr\s*no\.?$/i.test(t) || /^container/i.test(t);
  });
  if (ctnrItem && visible(ctnrItem)) {
    ctnrItem.click();
    return true;
  }
  return false;
}

function fillFirstContainerInput(containerNumber) {
  const inputs = Array.from(
    document.querySelectorAll('input[type="text"], input:not([type]), textarea'),
  ).filter((el) => visible(el) && !el.disabled && !el.readOnly);

  if (!inputs.length) return false;
  const target = inputs[0];
  target.focus();
  target.value = containerNumber;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function scrapeTrackingTable() {
  const tables = Array.from(document.querySelectorAll('table'));
  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll('th')).map((th) =>
      (th.textContent || '').replace(/\s+/g, ' ').trim(),
    );
    if (!headers.some((h) => /ctnr|container|status|vessel|voyage/i.test(h))) continue;

    const rows = Array.from(table.querySelectorAll('tbody tr, tr')).filter((tr) =>
      tr.querySelectorAll('td').length,
    );
    const parsedRows = rows.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')).map((td) =>
        (td.textContent || '').replace(/\s+/g, ' ').trim(),
      );
      const row = {};
      headers.forEach((header, index) => {
        if (header) row[header] = cells[index] || '';
      });
      if (!headers.length) {
        cells.forEach((cell, index) => {
          row[`col${index + 1}`] = cell;
        });
      }
      return row;
    }).filter((row) => Object.values(row).some(Boolean));

    if (!parsedRows.length) continue;

    const first = parsedRows[0];
    const pick = (...keys) => {
      for (const key of Object.keys(first)) {
        if (keys.some((k) => key.toLowerCase().includes(k))) return first[key] || null;
      }
      return null;
    };

    return {
      rows: parsedRows,
      containerNumber: pick('ctnr no', 'container') || null,
      eventAt: pick('ctnr date', 'date') || null,
      statusName: pick('status') || null,
      depotName: pick('depot') || null,
      voyage: pick('voyage') || null,
      vesselName: pick('vessel') || null,
      bookingRef: pick('more detail', 'booking', 'detail') || null,
    };
  }
  return null;
}

async function getJob() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'YW_WANHAI_GET_JOB' }, (response) => {
      resolve(response && response.job ? response.job : null);
    });
  });
}

function sendResult(payload) {
  chrome.runtime.sendMessage({ type: 'YW_WANHAI_RESULT', payload });
}

async function waitUntilReady(timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pageHasCaptcha() && (findQueryButton() || LIST_PATH.test(location.href))) {
      return true;
    }
    await sleep(1000);
  }
  return false;
}

async function runOnQueryPage(job) {
  const ready = await waitUntilReady();
  if (!ready) return;

  selectContainerSearchType();
  await sleep(400);
  if (!fillFirstContainerInput(job.containerNumber)) return;
  await sleep(300);
  const queryBtn = findQueryButton();
  if (queryBtn) queryBtn.click();
}

async function runOnListPage(job) {
  for (let i = 0; i < 20; i += 1) {
    const scraped = scrapeTrackingTable();
    if (scraped && (scraped.statusName || scraped.vesselName || scraped.rows.length)) {
      sendResult({
        purchaseOrderId: job.purchaseOrderId,
        containerNumber: scraped.containerNumber || job.containerNumber,
        blNumber: job.blNumber || null,
        statusName: scraped.statusName,
        depotName: scraped.depotName,
        voyage: scraped.voyage,
        vesselName: scraped.vesselName,
        eventAt: scraped.eventAt,
        bookingRef: scraped.bookingRef,
        rows: scraped.rows,
        fetchedAt: new Date().toISOString(),
        sourceUrl: location.href,
      });
      return;
    }
    await sleep(500);
  }
}

async function main() {
  const job = await getJob();
  if (!job || !job.containerNumber || !job.purchaseOrderId) return;

  if (LIST_PATH.test(location.href) || scrapeTrackingTable()) {
    await runOnListPage(job);
    return;
  }

  if (QUERY_PATH.test(location.href) || findQueryButton()) {
    await runOnQueryPage(job);
  }
}

void main();
