import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { CameraOff, Loader2, X } from 'lucide-react';

interface BarcodeScannerProps {
  onDetected: (value: string) => void;
  onClose: () => void;
}

type ScannerState = 'starting' | 'scanning' | 'error' | 'unsupported';

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/** Short confirmation beep on a successful scan. */
function playScanBeep() {
  try {
    const AudioCtx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1046, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => void ctx.close();
  } catch {
    // best-effort
  }
}

function stopVideoTracks(video: HTMLVideoElement | null) {
  const stream = video?.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) track.stop();
  }
  if (video) video.srcObject = null;
}

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * Logistics 1D formats. Prefer Code 128, but keep a few common slip formats so
 * a Code-128-only filter can't "never lock" on CODE_39 / ITF labels.
 */
const ZXING_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
];

const NATIVE_FORMATS = ['code_128', 'code_39', 'itf', 'codabar'] as const;

/** Horizontal band through the viewfinder — smaller canvas = much faster decode. */
function drawScanBand(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const cropW = Math.floor(vw * 0.92);
  const cropH = Math.max(48, Math.floor(vh * 0.28));
  const cropX = Math.floor((vw - cropW) / 2);
  const cropY = Math.floor((vh - cropH) / 2);

  // Cap decode width so phones stay responsive.
  const maxW = 960;
  const scale = cropW > maxW ? maxW / cropW : 1;
  const outW = Math.max(1, Math.floor(cropW * scale));
  const outH = Math.max(1, Math.floor(cropH * scale));

  if (canvas.width !== outW) canvas.width = outW;
  if (canvas.height !== outH) canvas.height = outH;

  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
  return ctx;
}

function normalizeScanText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const detectedRef = useRef(false);
  const lastCandidateRef = useRef<{ text: string; hits: number } | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const [state, setState] = useState<ScannerState>('starting');
  const [errorMessage, setErrorMessage] = useState('');
  const [session, setSession] = useState(0);

  useEffect(() => {
    let cancelled = false;
    detectedRef.current = false;
    lastCandidateRef.current = null;
    setState('starting');

    const secure = window.isSecureContext || location.hostname === 'localhost';
    if (!navigator.mediaDevices?.getUserMedia || !secure) {
      setState('unsupported');
      setErrorMessage(
        secure
          ? 'Camera is not available on this device.'
          : 'Camera scanning needs a secure (HTTPS) connection.',
      );
      return;
    }

    const accept = (raw: string) => {
      const text = normalizeScanText(raw);
      if (!text || detectedRef.current || cancelled) return;

      // Two matching hits in a row → accept (filters one-frame glitches without feeling slow).
      const prev = lastCandidateRef.current;
      if (prev && prev.text === text) {
        prev.hits += 1;
      } else {
        lastCandidateRef.current = { text, hits: 1 };
      }
      if ((lastCandidateRef.current?.hits ?? 0) < 2) return;

      detectedRef.current = true;
      playScanBeep();
      onDetectedRef.current(text);
    };

    const stopLoop = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const start = async () => {
      const video = videoRef.current;
      if (!video || cancelled) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play();

        // Continuous autofocus when the device supports it.
        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            await track.applyConstraints({
              // @ts-expect-error focusMode is supported on many mobile cameras
              advanced: [{ focusMode: 'continuous' }],
            });
          } catch {
            // ignore unsupported constraints
          }
        }

        if (cancelled) return;
        setState('scanning');

        const canvas = document.createElement('canvas');
        const Detector = getBarcodeDetector();
        let nativeDetector: BarcodeDetectorLike | null = null;
        if (Detector) {
          try {
            nativeDetector = new Detector({ formats: [...NATIVE_FORMATS] });
          } catch {
            nativeDetector = null;
          }
        }

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);
        // No TRY_HARDER — it freezes the UI on phones and makes scanning feel buggy.
        const zxing = new BrowserMultiFormatReader(hints);

        let busy = false;
        const tick = async () => {
          if (cancelled || detectedRef.current) return;
          if (busy || video.readyState < 2) {
            timerRef.current = window.setTimeout(() => {
              rafRef.current = requestAnimationFrame(() => void tick());
            }, 16);
            return;
          }

          busy = true;
          try {
            const ctx = drawScanBand(video, canvas);
            if (ctx) {
              if (nativeDetector) {
                const codes = await nativeDetector.detect(canvas);
                const value = codes.find(c => c.rawValue?.trim())?.rawValue;
                if (value) accept(value);
              } else {
                try {
                  const result = zxing.decodeFromCanvas(canvas);
                  const value = result?.getText?.();
                  if (value) accept(value);
                } catch {
                  // NotFound / checksum — keep looping
                }
              }
            }
          } catch {
            // keep looping
          } finally {
            busy = false;
            if (!cancelled && !detectedRef.current) {
              // ~20 attempts/sec when decode is fast; backs off naturally when busy.
              timerRef.current = window.setTimeout(() => {
                rafRef.current = requestAnimationFrame(() => void tick());
              }, nativeDetector ? 30 : 50);
            }
          }
        };

        rafRef.current = requestAnimationFrame(() => void tick());
      } catch (error) {
        if (cancelled) return;
        const name = (error as { name?: string })?.name;
        if (name === 'AbortError') return;
        setState('error');
        setErrorMessage(
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow access or enter the code manually.'
            : 'Could not start the camera. Enter the code manually.',
        );
      }
    };

    void start();

    return () => {
      cancelled = true;
      stopLoop();
      stopVideoTracks(videoRef.current);
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
    };
  }, [session]);

  return (
    <div className="barcode-scanner">
      <div className="barcode-scanner__viewport">
        {(state === 'starting' || state === 'scanning') && (
          <>
            <video
              ref={videoRef}
              className="barcode-scanner__video"
              muted
              playsInline
              autoPlay
            />
            <div className="barcode-scanner__frame" aria-hidden>
              <span className="barcode-scanner__laser" />
            </div>
            {state === 'starting' && (
              <div className="barcode-scanner__overlay">
                <Loader2 size={28} className="barcode-scanner__spin" aria-hidden />
                <span>Starting camera…</span>
              </div>
            )}
          </>
        )}
        {(state === 'error' || state === 'unsupported') && (
          <div className="barcode-scanner__overlay barcode-scanner__overlay--error">
            <CameraOff size={30} aria-hidden />
            <span>{errorMessage}</span>
            {state === 'error' && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSession(s => s + 1)}
              >
                Retry
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          className="barcode-scanner__close"
          onClick={onClose}
          aria-label="Close scanner"
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      {state === 'scanning' && (
        <p className="barcode-scanner__hint text-muted text-sm">
          Line up the barcode in the frame — hold steady for a moment.
        </p>
      )}
    </div>
  );
};
