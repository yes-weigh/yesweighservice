import { WebPlugin } from '@capacitor/core';
import type {
  WhatsAppSaveImageOptions,
  WhatsAppSaveImageResult,
  WhatsAppShareImageOptions,
  WhatsAppShareImageResult,
  WhatsAppSharePlugin,
} from './definitions';

export class WhatsAppShareWeb extends WebPlugin implements WhatsAppSharePlugin {
  async shareImage(_options: WhatsAppShareImageOptions): Promise<WhatsAppShareImageResult> {
    throw this.unimplemented(
      'Image share needs the YesWeigh Android APK (system share sheet).',
    );
  }

  async saveImage(_options: WhatsAppSaveImageOptions): Promise<WhatsAppSaveImageResult> {
    throw this.unimplemented(
      'Saving to the gallery needs the YesWeigh Android APK.',
    );
  }
}
