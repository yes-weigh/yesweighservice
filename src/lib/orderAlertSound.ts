/**
 * Unlock on the Verify click (user gesture), then play after Zoho returns.
 * Sounds like a short POS / online-order ding-ding.
 */
let unlockedCtx: AudioContext | null = null;

function audioContextCtor(): typeof AudioContext | null {
  return window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    ?? null;
}

export function unlockOrderAlertAudio(): void {
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
  peak = 0.2,
  type: OscillatorType = 'sine',
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.9), time + duration);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.016);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + duration + 0.04);
}

export function playOnlineOrderAlert(): void {
  try {
    unlockOrderAlertAudio();
    const ctx = unlockedCtx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    tone(ctx, t, 1174.66, 0.2, 0.18, 'sine');
    tone(ctx, t, 2349.32, 0.16, 0.06, 'triangle');
    tone(ctx, t + 0.15, 1567.98, 0.28, 0.22, 'sine');
    tone(ctx, t + 0.15, 3135.96, 0.2, 0.07, 'triangle');
    tone(ctx, t + 0.38, 2093.0, 0.42, 0.2, 'sine');
    tone(ctx, t + 0.38, 4186.0, 0.22, 0.05, 'triangle');
  } catch {
    // best-effort — autoplay / missing AudioContext
  }
}
