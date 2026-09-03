/**
 * Native APK reloads after a long background so a new hosting deploy shows up.
 * Hold that reload while a flow must survive screen-off / sticker-pasting / camera.
 */

const holders = new Set<string>();
let seq = 0;

export function holdNativeAppAlive(reason: string): () => void {
  const id = `${reason}:${++seq}`;
  holders.add(id);
  return () => {
    holders.delete(id);
  };
}

export function nativeAppHasKeepAlive(): boolean {
  return holders.size > 0;
}
