import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { CameraOff, Loader2, X } from 'lucide-react';

export interface SpareSkuQrScannerProps {
  /** Return true when the scan should close the scanner (accepted). */
  onDetected: (value: string) => boolean;
  onClose: () => void;
  title?: string;
  hint?: string;
  /** Shown when onDetected returns false. */
  missMessage?: string;
  ariaLabel?: string;
}

type ScannerState = 'starting' | 'scanning' | 'error' | 'unsupported';

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

/** Catalog / spare labels use QR only — keeps decode light so preview stays smooth. */
const SKU_QR_FORMATS = [BarcodeFormat.QR_CODE];

/**
 * Camera scanner for product / spare label SKU QR codes.
 * Stays open on a miss so the user can try again.
 */
export const SpareSkuQrScanner: React.FC<SpareSkuQrScannerProps> = ({
  onDetected,
  onClose,
  title = 'Scan QR',
  hint = 'Point at the label QR code.',
  missMessage = 'Not found',
  ariaLabel = 'Scan SKU QR',
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lockRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  const missMessageRef = useRef(missMessage);
  onDetectedRef.current = onDetected;
  missMessageRef.current = missMessage;

  const [state, setState] = useState<ScannerState>('starting');
  const [errorMessage, setErrorMessage] = useState('');
  const [miss, setMiss] = useState('');
  const [session, setSession] = useState(0);
  const missClearTimerRef = useRef<number | null>(null);
  const unlockTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    lockRef.current = false;
    setMiss('');
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

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, SKU_QR_FORMATS);
    // TRY_HARDER is expensive and makes the preview stutter on phones.
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 220,
      delayBetweenScanSuccess: 500,
    });

    const start = async () => {
      await new Promise<void>(resolve => {
        window.setTimeout(resolve, 60);
      });
      if (cancelled || !videoRef.current) return;

      try {
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 24, max: 30 },
            },
          },
          videoRef.current,
          (result) => {
            if (!result || lockRef.current || cancelled) return;
            lockRef.current = true;
            playScanBeep();
            const text = result.getText().trim();
            const matched = onDetectedRef.current(text);
            if (matched) {
              controls.stop();
              stopVideoTracks(videoRef.current);
              return;
            }
            const shown = text.length > 48 ? `${text.slice(0, 45)}…` : text;
            setMiss(shown
              ? `${missMessageRef.current}: ${shown}`
              : missMessageRef.current);
            if (missClearTimerRef.current) window.clearTimeout(missClearTimerRef.current);
            missClearTimerRef.current = window.setTimeout(() => setMiss(''), 3200);
            if (unlockTimerRef.current) window.clearTimeout(unlockTimerRef.current);
            unlockTimerRef.current = window.setTimeout(() => {
              if (!cancelled) lockRef.current = false;
            }, 900);
          },
        );

        if (cancelled) {
          controls.stop();
          stopVideoTracks(videoRef.current);
          return;
        }
        controlsRef.current = controls;
        setState('scanning');
      } catch (error) {
        if (cancelled) return;
        const name = (error as { name?: string })?.name;
        if (name === 'AbortError') return;
        setState('error');
        setErrorMessage(
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow access and try again.'
            : 'Could not start the camera.',
        );
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (missClearTimerRef.current) window.clearTimeout(missClearTimerRef.current);
      if (unlockTimerRef.current) window.clearTimeout(unlockTimerRef.current);
      controlsRef.current?.stop();
      controlsRef.current = null;
      stopVideoTracks(videoRef.current);
      try {
        reader.reset();
      } catch {
        // older zxing builds may not expose reset
      }
    };
  }, [session]);

  const modal = (
    <div
      className="spare-sku-qr-scanner"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
    >
      <div
        className="spare-sku-qr-scanner__panel"
        role="document"
        onClick={e => e.stopPropagation()}
      >
        <div className="spare-sku-qr-scanner__head">
          <h2 className="spare-sku-qr-scanner__title">{title}</h2>
          <button
            type="button"
            className="spare-sku-qr-scanner__close"
            onClick={onClose}
            aria-label="Close scanner"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
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
          </div>
          {state === 'scanning' && (
            <p className="barcode-scanner__hint text-muted text-sm">{hint}</p>
          )}
          {miss && (
            <p className="spare-sku-qr-scanner__miss" role="status" aria-live="polite">
              {miss}
            </p>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};
