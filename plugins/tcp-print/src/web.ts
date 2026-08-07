import { WebPlugin } from '@capacitor/core';
import type {
  TcpPrintPlugin,
  TcpPrintProbeOptions,
  TcpPrintProbeResult,
  TcpPrintSendOptions,
  TcpPrintSendResult,
} from './definitions';

export class TcpPrintWeb extends WebPlugin implements TcpPrintPlugin {
  async send(_options: TcpPrintSendOptions): Promise<TcpPrintSendResult> {
    throw this.unimplemented(
      'LAN label printing needs the YesWeigh Android APK (raw TCP is blocked in browsers).',
    );
  }

  async probe(_options: TcpPrintProbeOptions): Promise<TcpPrintProbeResult> {
    throw this.unimplemented(
      'LAN printer probe needs the YesWeigh Android APK (raw TCP is blocked in browsers).',
    );
  }
}
