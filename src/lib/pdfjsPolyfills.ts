/**
 * Polyfills required by pdfjs-dist on older Chromium / Android WebViews.
 * Import this before loading pdf.js (main thread). The legacy worker bundle
 * carries its own copies for the worker context.
 */

type MapWithHelpers<K, V> = Map<K, V> & {
  getOrInsert?(key: K, defaultValue: V): V;
  getOrInsertComputed?(key: K, callbackFn: (key: K) => V): V;
};

const mapProto = Map.prototype as MapWithHelpers<unknown, unknown>;

if (typeof mapProto.getOrInsertComputed !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value(this: Map<unknown, unknown>, key: unknown, callbackFn: (key: unknown) => unknown) {
      if (this.has(key)) return this.get(key);
      const value = callbackFn(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}

if (typeof mapProto.getOrInsert !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsert', {
    value(this: Map<unknown, unknown>, key: unknown, defaultValue: unknown) {
      if (this.has(key)) return this.get(key);
      this.set(key, defaultValue);
      return defaultValue;
    },
    writable: true,
    configurable: true,
  });
}
