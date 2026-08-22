import { registerPlugin } from '@capacitor/core';
import type { WanHaiTrackPlugin } from './definitions';

const WanHaiTrack = registerPlugin<WanHaiTrackPlugin>('WanHaiTrack', {
  web: () => import('./web').then(m => new m.WanHaiTrackWeb()),
});

export * from './definitions';
export { WanHaiTrack };
