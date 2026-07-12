import { WebPlugin } from '@capacitor/core';
import type {
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
}
