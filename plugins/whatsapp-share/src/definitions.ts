export interface WhatsAppShareImageOptions {
  /** PNG/JPEG bytes as base64 (no data: URL prefix) */
  dataBase64: string;
  /** File name including extension, e.g. product-share.png */
  fileName?: string;
  /** MIME type; default image/png */
  mimeType?: string;
  /**
   * Optional international digits (e.g. 919567933252).
   * When set on Android, opens WhatsApp directly to that chat with the image.
   */
  phone?: string;
  /** Optional caption shown with the shared image. */
  text?: string;
}

export interface WhatsAppShareImageResult {
  ok: true;
}

export interface WhatsAppSharePlugin {
  /** Open the system share sheet with the image (WhatsApp, email, etc.). */
  shareImage(options: WhatsAppShareImageOptions): Promise<WhatsAppShareImageResult>;
}
