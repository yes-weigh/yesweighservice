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
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
    return 'video/webm;codecs=vp9,opus';
  }
  if (MediaRecorder.isTypeSupported('video/webm')) {
    return 'video/webm';
  }
  return '';
}
