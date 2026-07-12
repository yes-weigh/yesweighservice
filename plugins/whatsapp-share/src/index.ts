import { registerPlugin } from '@capacitor/core';
import type { WhatsAppSharePlugin } from './definitions';

const WhatsAppShare = registerPlugin<WhatsAppSharePlugin>('WhatsAppShare', {
  web: () => import('./web').then(m => new m.WhatsAppShareWeb()),
});

export * from './definitions';
export { WhatsAppShare };
