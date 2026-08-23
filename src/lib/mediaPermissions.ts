export function evidenceCameraConstraints(
  facingMode: 'environment' | 'user',
  withAudio: boolean,
): MediaStreamConstraints {
  return {
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
      frameRate: { ideal: 24, max: 30 },
    },
    audio: withAudio,
  };
}

export function cameraPermissionErrorMessage(err: unknown, fallback: string): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Allow Camera and Microphone for YesOne in phone settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera found. Use the gallery button to choose a file.';
  }
  return fallback;
}

export async function getEvidenceCameraStream(
  facingMode: 'environment' | 'user',
  withAudio: boolean,
): Promise<MediaStream> {
  const preferred = evidenceCameraConstraints(facingMode, withAudio);
  try {
    return await navigator.mediaDevices.getUserMedia(preferred);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'OverconstrainedError' || name === 'NotFoundError') {
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: withAudio,
      });
    }
    throw err;
  }
}
