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

export interface WhatsAppSaveImageOptions {
  /** Remote image URL — downloaded natively (bypasses WebView CORS). */
  url?: string;
  /** PNG/JPEG bytes as base64 (no data: URL prefix). Used when `url` is omitted. */
  dataBase64?: string;
  /** File name including extension, e.g. product.jpg */
  fileName?: string;
  /** MIME type; inferred from the response or file name when omitted */
  mimeType?: string;
}

export interface WhatsAppSaveImageResult {
  ok: true;
  uri?: string;
}

export interface WhatsAppSharePlugin {
  /** Open the system share sheet with the image (WhatsApp, email, etc.). */
  shareImage(options: WhatsAppShareImageOptions): Promise<WhatsAppShareImageResult>;
  /** Save the image into Pictures/YesWeigh so it appears in the phone gallery. */
  saveImage(options: WhatsAppSaveImageOptions): Promise<WhatsAppSaveImageResult>;
}
