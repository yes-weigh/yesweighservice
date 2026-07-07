import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { CameraOff, Loader2, X } from 'lucide-react';

interface BarcodeScannerProps {
  onDetected: (value: string) => void;
  onClose: () => void;
}

type ScannerState = 'starting' | 'scanning' | 'error' | 'unsupported';

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const detectedRef = useRef(false);
  const [state, setState] = useState<ScannerState>('starting');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

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
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current!,
          (result, err) => {
            if (result && !detectedRef.current) {
              detectedRef.current = true;
              onDetected(result.getText());
              controls.stop();
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
