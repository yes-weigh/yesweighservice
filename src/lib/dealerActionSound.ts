/** Unlock on the Create / Delete tap (user gesture), then play after the result. */

let unlockedCtx: AudioContext | null = null;

function audioContextCtor(): typeof AudioContext | null {
  return window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    ?? null;
}

export function unlockDealerActionAudio(): void {
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
  osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.92), time + duration);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.016);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + duration + 0.04);
}

function playSuccess(ctx: AudioContext) {
  const t = ctx.currentTime + 0.02;
  tone(ctx, t, 523.25, 0.1, 0.14, 'sine');
  tone(ctx, t + 0.1, 659.25, 0.12, 0.16, 'sine');
  tone(ctx, t + 0.22, 783.99, 0.28, 0.2, 'triangle');
}

function playFail(ctx: AudioContext) {
  const t = ctx.currentTime + 0.02;
  tone(ctx, t, 392, 0.16, 0.16, 'sawtooth');
  tone(ctx, t + 0.12, 277.18, 0.32, 0.18, 'square');
}

function play(kind: 'success' | 'fail') {
  try {
    unlockDealerActionAudio();
    const ctx = unlockedCtx;
    if (!ctx) return;
    const run = kind === 'success' ? playSuccess : playFail;
    if (ctx.state === 'suspended') {
      void ctx.resume().then(() => {
        if (unlockedCtx === ctx && ctx.state === 'running') run(ctx);
      });
      return;
    }
    run(ctx);
  } catch {
    // best-effort — autoplay / missing AudioContext
  }
}

export function playDealerSuccessSound(): void {
  play('success');
}

export function playDealerFailSound(): void {
  play('fail');
}
