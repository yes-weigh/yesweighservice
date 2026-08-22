/**
 * Unlock on the map-open / Fetch live tap (user gesture), then play after AIS returns.
 * Short two-note success chime.
 */
let unlockedCtx: AudioContext | null = null;

function audioContextCtor(): typeof AudioContext | null {
  return window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    ?? null;
}

export function unlockVoyageAisAudio(): void {
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  if (!unlockedCtx || unlockedCtx.state === 'closed') {
    unlockedCtx = new Ctor();
  }
  void unlockedCtx.resume();
}

function tone(
  ctx: AudioContext,
  time: number,
  freq: number,
  duration: number,
  peak = 0.18,
  type: OscillatorType = 'sine',
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.94), time + duration);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.014);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + duration + 0.04);
}

function playChime(ctx: AudioContext) {
  const t = ctx.currentTime + 0.02;
  tone(ctx, t, 880, 0.12, 0.15, 'sine');
  tone(ctx, t + 0.11, 1318.51, 0.26, 0.2, 'sine');
  tone(ctx, t + 0.11, 1760, 0.18, 0.06, 'triangle');
}

export function playVoyageAisSuccessSound(): void {
  try {
    unlockVoyageAisAudio();
    const ctx = unlockedCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().then(() => {
        if (unlockedCtx === ctx && ctx.state === 'running') playChime(ctx);
      });
      return;
    }
    playChime(ctx);
  } catch {
    // best-effort — autoplay / missing AudioContext
  }
}
