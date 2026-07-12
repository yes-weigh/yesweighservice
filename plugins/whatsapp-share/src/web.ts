import { WebPlugin } from '@capacitor/core';
import type {
  WhatsAppShareImageOptions,
  WhatsAppShareImageResult,
  WhatsAppSharePlugin,
} from './definitions';

export class WhatsAppShareWeb extends WebPlugin implements WhatsAppSharePlugin {
  async shareImage(_options: WhatsAppShareImageOptions): Promise<WhatsAppShareImageResult> {
    throw this.unimplemented(
      'Direct WhatsApp image share needs the YesWeigh Android APK.',
    );
  }
}
