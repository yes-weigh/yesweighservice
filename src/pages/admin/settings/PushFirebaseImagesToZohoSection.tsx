import React, { useCallback, useRef, useState } from 'react';
import { CloudUpload, RefreshCw, StopCircle } from 'lucide-react';
import { useConfirm } from '../../../context/ConfirmContext';
import {
  listCatalogProductsWithFirebaseImages,
  pushMissingCatalogProductImagesToZoho,
  type CatalogProductWithFirebaseImages,
} from '../../../lib/catalog';

const DELAY_AFTER_UPLOAD_MS = 800;
const DELAY_AFTER_SKIP_MS = 350;

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    window.setTimeout(resolve, ms);
  });
}

type RunSummary = {
  processed: number;
  total: number;
  uploadedImages: number;
  alreadyInSync: number;
  failedProducts: number;
  stoppedEarly: boolean;
  stopReason: string | null;
};

const EMPTY_SUMMARY: RunSummary = {
  processed: 0,
  total: 0,
  uploadedImages: 0,
  alreadyInSync: 0,
  failedProducts: 0,
  stoppedEarly: false,
  stopReason: null,
};

export const PushFirebaseImagesToZohoSection: React.FC = () => {
  const confirm = useConfirm();
  const cancelRef = useRef(false);
  const [loadingList, setLoadingList] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [statusLine, setStatusLine] = useState('');
  const [summary, setSummary] = useState<RunSummary>(EMPTY_SUMMARY);
  const [failures, setFailures] = useState<Array<{ sku: string; message: string }>>([]);

  const stopRun = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const runBulkPush = useCallback(async () => {
    setError('');
    setFailures([]);
    setSummary(EMPTY_SUMMARY);
    setStatusLine('Loading products with Firebase images…');
    setLoadingList(true);

    let products: CatalogProductWithFirebaseImages[] = [];
    try {
      products = await listCatalogProductsWithFirebaseImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load catalog products.');
      setStatusLine('');
      setLoadingList(false);
      return;
    }
    setLoadingList(false);

    if (products.length === 0) {
      setStatusLine('No catalog products with Firebase images were found.');
      return;
    }

    const ok = await confirm({
      title: 'Push Firebase images to Zoho?',
      message:
        `This will check ${products.length} product${products.length === 1 ? '' : 's'} `
        + `that have images in Firebase, and upload any images missing from Zoho.\n\n`
        + `Runs slowly to respect Zoho rate limits. You can stop mid-run and resume later.\n\n`
        + `When finished, run Catalog Sync so Firebase matches Zoho again.`,
      confirmLabel: `Start (${products.length})`,
      destructive: false,
    });
    if (!ok) {
      setStatusLine('');
      return;
    }

    cancelRef.current = false;
    setRunning(true);
    const nextSummary: RunSummary = {
      ...EMPTY_SUMMARY,
      total: products.length,
    };

    for (let i = 0; i < products.length; i += 1) {
      if (cancelRef.current) {
        nextSummary.stoppedEarly = true;
        nextSummary.stopReason = 'Stopped by you.';
        break;
      }

      const product = products[i];
      setStatusLine(
        `Checking ${i + 1}/${products.length}: ${product.sku}`
        + (product.name ? ` — ${product.name}` : ''),
      );

      try {
        const result = await pushMissingCatalogProductImagesToZoho(product.id, {
          dryRun: false,
        });
        nextSummary.processed += 1;
        nextSummary.uploadedImages += result.uploadedCount;
        if (result.missingCount <= 0) {
          nextSummary.alreadyInSync += 1;
        }
        if (result.failedCount > 0) {
          nextSummary.failedProducts += 1;
          setFailures(prev => [
            ...prev,
            {
              sku: product.sku,
              message: result.message || `${result.failedCount} image(s) failed`,
            },
          ]);
        }
        if (/rate limit/i.test(result.message)) {
          nextSummary.stoppedEarly = true;
          nextSummary.stopReason = result.message;
          setSummary({ ...nextSummary });
          break;
        }
        setSummary({ ...nextSummary });
        await sleep(result.uploadedCount > 0 ? DELAY_AFTER_UPLOAD_MS : DELAY_AFTER_SKIP_MS);
      } catch (err) {
        nextSummary.processed += 1;
        nextSummary.failedProducts += 1;
        const message = err instanceof Error ? err.message : 'Push failed.';
        setFailures(prev => [...prev, { sku: product.sku, message }]);
        setSummary({ ...nextSummary });
        if (/rate limit|resource.?exhausted|too many requests/i.test(message)) {
          nextSummary.stoppedEarly = true;
          nextSummary.stopReason = message;
          setSummary({ ...nextSummary });
          break;
        }
        await sleep(DELAY_AFTER_SKIP_MS);
      }
    }

    setRunning(false);
    setSummary({ ...nextSummary });

    if (nextSummary.stoppedEarly) {
      setStatusLine(
        nextSummary.stopReason
          || `Stopped early after ${nextSummary.processed}/${nextSummary.total} products.`,
      );
    } else {
      setStatusLine(
        `Done. Checked ${nextSummary.processed} product${nextSummary.processed === 1 ? '' : 's'}; `
        + `uploaded ${nextSummary.uploadedImages} image${nextSummary.uploadedImages === 1 ? '' : 's'}. `
        + `Run Catalog Sync when ready.`,
      );
    }
  }, [confirm]);

  const busy = loadingList || running;

  return (
    <div className="settings-product-qty__section settings-product-images">
      <h4 className="settings-product-qty__title">Push Firebase images to Zoho</h4>
      <p className="settings-product-qty__hint text-muted text-sm">
        Iterates every catalog product that has images in Firebase, compares each to Zoho,
        and uploads only the images Zoho is missing. After it finishes, run Catalog Sync.
      </p>

      {error && <p className="settings-locations__error text-sm">{error}</p>}

      <div className="settings-product-mrp__actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void runBulkPush()}
        >
          {busy
            ? <RefreshCw size={15} className="spin-icon" aria-hidden />
            : <CloudUpload size={15} aria-hidden />}
          {loadingList ? 'Loading…' : running ? 'Pushing…' : 'Push all Firebase images'}
        </button>
        {running && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={stopRun}
          >
            <StopCircle size={15} aria-hidden />
            Stop
          </button>
        )}
      </div>

      {statusLine && (
        <p className="settings-product-qty__hint text-sm" style={{ marginTop: '0.75rem' }}>
          {statusLine}
        </p>
      )}

      {summary.total > 0 && (
        <p className="text-muted text-sm" style={{ marginTop: '0.5rem' }}>
          Progress: {summary.processed}/{summary.total}
          {' · '}
          uploaded {summary.uploadedImages}
          {' · '}
          already in sync {summary.alreadyInSync}
          {' · '}
          failed {summary.failedProducts}
        </p>
      )}

      {failures.length > 0 && (
        <ul className="settings-product-images__failures text-sm">
          {failures.slice(-20).map((row, index) => (
            <li key={`${row.sku}-${index}`}>
              <strong>{row.sku}</strong>
              {': '}
              {row.message}
            </li>
          ))}
          {failures.length > 20 && (
            <li className="text-muted">…and {failures.length - 20} more</li>
          )}
        </ul>
      )}
    </div>
  );
};
