export interface WhatsAppShareImageOptions {
  /** PNG/JPEG bytes as base64 (no data: URL prefix) */
  dataBase64: string;
  /** File name including extension, e.g. product-share.png */
  fileName?: string;
  /** MIME type; default image/png */
  mimeType?: string;
}

export interface WhatsAppShareImageResult {
  ok: true;
}

export interface WhatsAppSharePlugin {
  /** Open WhatsApp (or WhatsApp Business) with the image attached. */
  shareImage(options: WhatsAppShareImageOptions): Promise<WhatsAppShareImageResult>;
}
