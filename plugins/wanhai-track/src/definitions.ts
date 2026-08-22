export interface WanHaiTrackOptions {
  /** Wan Hai tracking query URL */
  url: string;
  /** Container number to paste after CAPTCHA */
  containerNumber: string;
}

export interface WanHaiTrackResult {
  ok: true;
  containerNumber: string;
  statusName: string | null;
  depotName: string | null;
  voyage: string | null;
  vesselName: string | null;
  eventAt: string | null;
  bookingRef: string | null;
  rowsJson: string;
  sourceUrl: string | null;
}

export interface WanHaiTrackPlugin {
  /**
   * Opens Wan Hai in an in-app WebView (Android).
   * User passes CAPTCHA, taps Track — plugin pastes container, queries, returns status.
   */
  track(options: WanHaiTrackOptions): Promise<WanHaiTrackResult>;
}
