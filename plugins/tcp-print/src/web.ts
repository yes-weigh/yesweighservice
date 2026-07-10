import { WebPlugin } from '@capacitor/core';
import type { TcpPrintPlugin, TcpPrintSendOptions, TcpPrintSendResult } from './definitions';

export class TcpPrintWeb extends WebPlugin implements TcpPrintPlugin {
  async send(_options: TcpPrintSendOptions): Promise<TcpPrintSendResult> {
    throw this.unimplemented(
      'LAN label printing needs the YesWeigh Android APK (raw TCP is blocked in browsers).',
    );
  }
}
