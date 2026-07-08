import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { CameraOff, Loader2, X } from 'lucide-react';

interface BarcodeScannerProps {
  onDetected: (value: string) => void;
  onClose: () => void;
}

type ScannerState = 'starting' | 'scanning' | 'error' | 'unsupported';

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
    // Audio is best-effort; ignore failures.
  }
}

// Formats actually used on courier slips — limiting these massively speeds up decoding.
const COURIER_BARCODE_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.EAN_13,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
];

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const detectedRef = useRef(false);
  const [state, setState] = useState<ScannerState>('starting');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, COURIER_BARCODE_FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    // Default is one attempt every 500ms; scan far more frequently for a snappy feel.
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 90,
      delayBetweenScanSuccess: 90,
    });

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

    const start = async () => {
      try {
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current!,
          (result, err) => {
            if (result && !detectedRef.current) {
              detectedRef.current = true;
              playScanBeep();
              controls.stop();
              onDetected(result.getText());
            }
            void err;
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setState('scanning');
      } catch (error) {
        if (cancelled) return;
        const name = (error as { name?: string })?.name;
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
      controlsRef.current?.stop();
    };
  }, [onDetected]);

  return (
    <div className="barcode-scanner">
      <div className="barcode-scanner__viewport">
        {(state === 'starting' || state === 'scanning') && (
          <>
            <video ref={videoRef} className="barcode-scanner__video" muted playsInline />
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
          Point the camera at the courier barcode or QR code.
        </p>
      )}
    </div>
  );
};
