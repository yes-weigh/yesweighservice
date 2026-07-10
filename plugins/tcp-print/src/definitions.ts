export interface TcpPrintSendOptions {
  /** Printer LAN IP, e.g. 192.168.1.39 */
  host: string;
  /** Raw print port; default 9100 */
  port?: number;
  /** Payload as base64 (TSPL/ZPL/raw bytes) */
  dataBase64: string;
  /** Connect + write timeout in ms; default 8000 */
  timeoutMs?: number;
}

export interface TcpPrintSendResult {
  ok: true;
  bytesSent: number;
}

export interface TcpPrintPlugin {
  send(options: TcpPrintSendOptions): Promise<TcpPrintSendResult>;
}
