import { WebPlugin } from '@capacitor/core';
import type { WanHaiTrackOptions, WanHaiTrackPlugin, WanHaiTrackResult } from './definitions';

export class WanHaiTrackWeb extends WebPlugin implements WanHaiTrackPlugin {
  async track(_options: WanHaiTrackOptions): Promise<WanHaiTrackResult> {
    throw this.unimplemented(
      'Wan Hai auto-track after CAPTCHA needs the YesOne Android app.',
    );
  }
}
