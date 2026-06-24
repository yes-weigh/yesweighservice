export async function capturePhotoFromVideo(video: HTMLVideoElement): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not capture photo.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>(resolve => {
    canvas.toBlob(resolve, 'image/jpeg', 0.92);
  });
  if (!blob) throw new Error('Could not capture photo.');

  return new File([blob], `photo-${Date.now()}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

export function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach(track => track.stop());
}

export function pickAudioMimeType(): string {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus';
  }
  if (MediaRecorder.isTypeSupported('audio/webm')) {
    return 'audio/webm';
  }
  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
    return 'audio/ogg;codecs=opus';
  }
  return '';
}

export function pickVideoMimeType(): string {
  const isChromium = /Chrome|Chromium|Edg\//.test(navigator.userAgent);
  const webmCandidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];
  const mp4Candidates = ['video/mp4'];

  // Chromium MP4 MediaRecorder output is often not playable from a remote URL (fMP4 metadata).
  const candidates = isChromium
    ? webmCandidates
    : [...mp4Candidates, ...webmCandidates];

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function createVideoMediaRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = pickVideoMimeType();
  if (!mimeType) {
    throw new Error('Video recording is not supported on this device.');
  }

  return new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000,
  });
}

export function createVideoFileFromBlob(blob: Blob, mimeType: string): File {
  const type = blob.type || mimeType || 'video/webm';
  return new File(
    [blob],
    `video-${Date.now()}.${videoFileExtension(type)}`,
    { type, lastModified: Date.now() },
  );
}

export async function finalizeMediaRecorder(
  recorder: MediaRecorder,
  existingChunks: Blob[] = [],
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const chunks = [...existingChunks];

    const onData = (event: BlobEvent) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const onStop = () => {
      recorder.removeEventListener('dataavailable', onData);
      const type = recorder.mimeType || chunks[0]?.type || 'video/webm';
      const blob = new Blob(chunks, { type });
      if (blob.size < 1024) {
        reject(new Error('Recording was too short. Hold record for at least one second.'));
        return;
      }
      resolve(blob);
    };

    const onError = () => {
      recorder.removeEventListener('dataavailable', onData);
      reject(new Error('Could not finish recording.'));
    };

    recorder.addEventListener('dataavailable', onData);
    recorder.addEventListener('stop', onStop, { once: true });
    recorder.addEventListener('error', onError, { once: true });

    if (recorder.state === 'recording') {
      try {
        recorder.requestData();
      } catch {
        // Some browsers throw if no timeslice was configured.
      }
    }

    try {
      recorder.stop();
    } catch (err) {
      recorder.removeEventListener('dataavailable', onData);
      reject(err instanceof Error ? err : new Error('Could not stop recording.'));
    }
  });
}

export async function validateVideoBlob(blob: Blob): Promise<boolean> {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timeout')), 8000);
      video.addEventListener('loadedmetadata', () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
      video.addEventListener('error', () => {
        window.clearTimeout(timer);
        reject(new Error('invalid'));
      }, { once: true });
    });

    return video.duration > 0 && Number.isFinite(video.duration);
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function videoFileExtension(mimeType: string): string {
  const type = mimeType.toLowerCase();
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('quicktime')) return 'mov';
  return 'webm';
}

export async function captureVideoPoster(file: File): Promise<Blob | null> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => resolve();
      const onError = () => reject(new Error('Could not read video.'));
      video.addEventListener('loadeddata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    });

    if (video.duration > 0.12 && Number.isFinite(video.duration)) {
      video.currentTime = Math.min(0.12, video.duration * 0.05);
      await new Promise<void>(resolve => {
        video.addEventListener('seeked', () => resolve(), { once: true });
      });
    }

    if (!video.videoWidth || !video.videoHeight) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.82);
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
