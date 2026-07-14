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

function stopVideoTracks(video: HTMLVideoElement | null) {
  const stream = video?.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) track.stop();
  }
  if (video) video.srcObject = null;
}

// Code 128 only — courier consignment barcodes; fewer formats = faster decode.
const COURIER_BARCODE_FORMATS = [BarcodeFormat.CODE_128];

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const detectedRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const [state, setState] = useState<ScannerState>('starting');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [session, setSession] = useState(0);

  useEffect(() => {
    let cancelled = false;
    detectedRef.current = false;
    setState('starting');

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, COURIER_BARCODE_FORMATS);
    // Skip TRY_HARDER — too heavy for live preview on phones.
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 200,
      delayBetweenScanSuccess: 400,
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
            if (!result || detectedRef.current || cancelled) return;
            detectedRef.current = true;
            playScanBeep();
            controls.stop();
            stopVideoTracks(videoRef.current);
            onDetectedRef.current(result.getText());
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
            ? 'Camera permission was denied. Allow access or enter the code manually.'
            : 'Could not start the camera. Enter the code manually.',
        );
      }
    };

    void start();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      stopVideoTracks(videoRef.current);
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
          Point the camera at the courier barcode.
        </p>
      )}
    </div>
  );
};
