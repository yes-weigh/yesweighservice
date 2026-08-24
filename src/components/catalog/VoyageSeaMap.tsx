import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CalendarDays, Clock, Gauge, MapPin, RefreshCw, Route, Ship } from 'lucide-react';
import { lookupPurchaseOrderVesselAis, type VesselAisSnapshot } from '../../lib/admin-purchase-orders';
import { formatInvoiceDate } from '../../lib/invoices';
import {
  nearestProgressOnRoute,
  prettyPortName,
  resolveVoyagePorts,
  routeDistanceNm,
  seaRouteWaypoints,
  splitRouteAtProgress,
  voyageDaysUntilEta,
  voyageProgressBetweenDates,
  voyageTransitDays,
} from '../../lib/sea-voyage-route';
import { playVoyageAisSuccessSound, unlockVoyageAisAudio } from '../../lib/voyageAisSuccessSound';

function escapeMapLabel(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toLatLngs(points: { lat: number; lon: number }[]): L.LatLngExpression[] {
  return points.map(point => [point.lat, point.lon]);
}

function cleanAisDest(raw: string): string {
  const first = raw
    .split(',')[0]
    .replace(/&quot;|"/gi, ' ')
    .replace(/B{4,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return prettyPortName(first);
}

function formatAisArrival(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const date = formatInvoiceDate(raw);
  if (date === '—') return raw;
  const time = raw.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(time) ? `${date}, ${time}` : date;
}

function formatAisStampIst(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const wall = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!wall) return raw;
  const utcMs = Date.UTC(
    Number(wall[1]),
    Number(wall[2]) - 1,
    Number(wall[3]),
    Number(wall[4]) - 8,
    Number(wall[5]),
    Number(wall[6] || 0),
  );
  const at = new Date(utcMs);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  }).format(at);
  const time = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(at);
  return `${date}, ${time} (IST)`;
}

function AisFetchingLabel({ compact = false }: { compact?: boolean }) {
  return (
    <strong className={`voyage-sea-map__fetching${compact ? ' voyage-sea-map__fetching--compact' : ''}`}>
      <i className="voyage-sea-map__fetch-ring" aria-hidden />
      Fetching data
    </strong>
  );
}

const SHIP_ICON_SVG = `<svg viewBox="0 0 64 64" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 36h56l-8 14H12z" fill="#1e3a8a" stroke="#0f172a" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M10 36V28h16v8H10z" fill="#ea580c" stroke="#0f172a" stroke-width="1.6"/>
  <path d="M26 36V24h12v12H26z" fill="#eab308" stroke="#0f172a" stroke-width="1.6"/>
  <path d="M38 36V22h10v14H38z" fill="#f8fafc" stroke="#0f172a" stroke-width="1.8"/>
  <path d="M42 22V12h6v10h-6z" fill="#94a3b8" stroke="#0f172a" stroke-width="1.6"/>
  <circle cx="45" cy="16" r="1.4" fill="#38bdf8"/>
</svg>`;

const POD_PIN_SVG = `<svg viewBox="0 0 28 40" width="28" height="40" xmlns="http://www.w3.org/2000/svg">
  <path d="M14 0C6.3 0 0 6.1 0 13.6 0 24 14 40 14 40s14-16 14-26.4C28 6.1 21.7 0 14 0z" fill="#16a34a" stroke="#fff" stroke-width="1.6"/>
  <circle cx="14" cy="14" r="5" fill="#fff"/>
</svg>`;

type Props = {
  portOfLoading: string;
  portOfDischarge: string;
  vesselName?: string | null;
  imo?: string | null;
  mmsi?: string | null;
  etd?: string | null;
  eta?: string | null;
};

const AIS_POLL_MS = 120_000;

export function VoyageSeaMap({
  portOfLoading,
  portOfDischarge,
  vesselName,
  imo,
  mmsi,
  etd,
  eta,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const aisRequestRef = useRef(0);
  const [ais, setAis] = useState<VesselAisSnapshot | null>(null);
  const [aisReady, setAisReady] = useState(false);
  const aisKeyword = useMemo(
    () => [imo, mmsi, vesselName].map(value => String(value || '').trim()).find(Boolean) || '',
    [imo, mmsi, vesselName],
  );

  const fetchLiveAis = useCallback((visible: boolean) => {
    if (!aisKeyword) {
      setAis(null);
      setAisReady(true);
      return;
    }
    const requestId = ++aisRequestRef.current;
    if (visible) {
      setAisReady(false);
      unlockVoyageAisAudio();
    }
    void lookupPurchaseOrderVesselAis(aisKeyword)
      .then(next => {
        if (requestId !== aisRequestRef.current) return;
        setAis(next);
        setAisReady(true);
        if (visible && next) playVoyageAisSuccessSound();
      })
      .catch(() => {
        if (requestId !== aisRequestRef.current) return;
        setAisReady(true);
      });
  }, [aisKeyword]);

  useEffect(() => {
    if (!aisKeyword) {
      setAis(null);
      setAisReady(true);
      return;
    }
    setAis(null);
    fetchLiveAis(true);
    const timer = window.setInterval(() => fetchLiveAis(false), AIS_POLL_MS);
    return () => {
      aisRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [aisKeyword, fetchLiveAis]);

  const destLabel = prettyPortName(portOfDischarge || 'Cochin');
  const aisNextPort = ais?.dest ? cleanAisDest(ais.dest) : '';
  const aisArrival = formatAisArrival(ais?.eta);

  useEffect(() => {
    const host = hostRef.current;
    const ports = resolveVoyagePorts(portOfLoading, destLabel);
    if (!host || !ports) return;

    const route = seaRouteWaypoints(ports.load, ports.discharge);
    const livePoint = ais?.lat != null && ais?.lon != null && !(ais.lat === 0 && ais.lon === 0)
      ? { lat: ais.lat, lon: ais.lon }
      : null;
    const progress = livePoint
      ? nearestProgressOnRoute(route, livePoint)
      : voyageProgressBetweenDates(etd, eta);
    const split = splitRouteAtProgress(route, progress);
    const ship = livePoint ?? split.ship;
    const { traveled, remaining } = split;

    const map = L.map(host, {
      zoomControl: false,
      attributionControl: false,
    });
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 12,
    }).addTo(map);

    L.polyline(toLatLngs(traveled), {
      color: '#1e3a8a',
      weight: 2.5,
      opacity: 0.95,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);

    L.polyline(toLatLngs(remaining), {
      color: '#3b82f6',
      weight: 2.5,
      opacity: 0.95,
      dashArray: '2 10',
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);

    const polName = escapeMapLabel(prettyPortName(portOfLoading).toUpperCase());
    const podName = escapeMapLabel(destLabel.toUpperCase());
    const etdLabel = etd ? escapeMapLabel(`ETD ${formatInvoiceDate(etd)}`) : 'ETD —';
    const etaLabel = eta ? escapeMapLabel(`ETA ${formatInvoiceDate(eta)}`) : 'ETA —';

    L.circleMarker([ports.load.lat, ports.load.lon], {
      radius: 8,
      color: '#1d4ed8',
      weight: 2,
      fillColor: '#1d4ed8',
      fillOpacity: 1,
    }).addTo(map);
    L.marker([ports.load.lat, ports.load.lon], {
      interactive: false,
      icon: L.divIcon({
        className: 'voyage-sea-map__port-label voyage-sea-map__port-label--pol',
        html: `<div class="voyage-sea-map__port-card"><strong>POL · ${polName}</strong><span>${etdLabel}</span></div>`,
        iconSize: [1, 1],
        iconAnchor: [-10, 10],
      }),
    }).addTo(map);

    L.marker([ports.discharge.lat, ports.discharge.lon], {
      interactive: false,
      icon: L.divIcon({
        className: 'voyage-sea-map__pin',
        html: POD_PIN_SVG,
        iconSize: [28, 40],
        iconAnchor: [14, 38],
      }),
    }).addTo(map);
    L.marker([ports.discharge.lat, ports.discharge.lon], {
      interactive: false,
      icon: L.divIcon({
        className: 'voyage-sea-map__port-label voyage-sea-map__port-label--pod',
        html: `<div class="voyage-sea-map__port-card"><strong>POD · ${podName}</strong><span>${etaLabel}</span></div>`,
        iconSize: [1, 1],
        iconAnchor: [-12, 16],
      }),
    }).addTo(map);

    L.marker([ship.lat, ship.lon], {
      icon: L.divIcon({
        className: 'voyage-sea-map__ship',
        html: `<span class="voyage-sea-map__ship-mark" aria-hidden="true">${SHIP_ICON_SVG}</span>`,
        iconSize: [48, 48],
        iconAnchor: [24, 24],
      }),
    }).addTo(map);

    const bounds = L.latLngBounds(toLatLngs(route));
    bounds.extend([ship.lat, ship.lon]);
    let viewTimer = 0;
    const applyView = () => {
      window.clearTimeout(viewTimer);
      viewTimer = window.setTimeout(() => {
        map.invalidateSize();
        if (host.clientHeight < 80 || host.clientWidth < 80) return;
        map.fitBounds(bounds, {
          paddingTopLeft: [10, 10],
          paddingBottomRight: [44, 72],
          maxZoom: 5,
          animate: false,
        });
      }, 40);
    };
    applyView();
    const later = window.setTimeout(applyView, 280);
    window.addEventListener('resize', applyView);
    const observer = new ResizeObserver(applyView);
    observer.observe(host);

    return () => {
      window.clearTimeout(viewTimer);
      window.clearTimeout(later);
      window.removeEventListener('resize', applyView);
      observer.disconnect();
      map.remove();
    };
  }, [portOfLoading, destLabel, etd, eta, ais?.lat, ais?.lon]);

  const ports = resolveVoyagePorts(portOfLoading, destLabel);
  if (!ports) {
    return (
      <p className="text-muted text-sm catalog-on-order-dialog__map-empty">
        Add port of loading and port of final discharge to show the sea route.
      </p>
    );
  }

  const route = seaRouteWaypoints(ports.load, ports.discharge);
  const livePoint = ais?.lat != null && ais?.lon != null && !(ais.lat === 0 && ais.lon === 0)
    ? { lat: ais.lat, lon: ais.lon }
    : null;
  const progress = livePoint
    ? nearestProgressOnRoute(route, livePoint)
    : voyageProgressBetweenDates(etd, eta);
  const split = splitRouteAtProgress(route, progress);
  const remainingNm = livePoint ? routeDistanceNm(split.remaining) : null;
  const liveSpeedKn = ais?.sog ?? null;
  const daysUntil = voyageDaysUntilEta(eta);
  const transitDays = voyageTransitDays(etd, eta);
  const fromPort = prettyPortName(portOfLoading) || 'POL';
  const toPort = destLabel;
  const nextPort = aisNextPort || toPort;
  const fetchingAis = !aisReady;

  return (
    <div className="voyage-sea-map">
      <div className="voyage-sea-map__stage">
        <aside className="voyage-sea-map__info" aria-label="Vessel details">
          <div className="voyage-sea-map__info-head">
            <span className="voyage-sea-map__info-icon" aria-hidden>
              <Ship size={16} strokeWidth={2.3} />
            </span>
            <div>
              <strong className="voyage-sea-map__info-name">
                {vesselName?.trim() || 'Vessel'}
              </strong>
              <span className="voyage-sea-map__info-type">Container Ship</span>
            </div>
          </div>
          {imo || ais?.imo ? <span>IMO Number: {imo || ais?.imo}</span> : null}
          <span>Next Port: {nextPort}</span>
          {aisNextPort && aisArrival ? (
            <span className="voyage-sea-map__info-date">
              ETA {aisNextPort}: {aisArrival}
            </span>
          ) : null}
          {fetchingAis ? (
            <span className="voyage-sea-map__info-fetching" role="status" aria-live="polite">
              <i className="voyage-sea-map__fetch-ring" aria-hidden />
              Fetching data
            </span>
          ) : liveSpeedKn != null ? (
            <span className="voyage-sea-map__info-date">Live speed: {liveSpeedKn.toFixed(1)} kn</span>
          ) : null}
          <span className="voyage-sea-map__info-date">
            ETA {toPort}: {eta ? formatInvoiceDate(eta) : '—'}
          </span>
          <span className="voyage-sea-map__info-date">
            ETD {fromPort}: {etd ? formatInvoiceDate(etd) : '—'}
          </span>
          {ais?.updated ? (
            <span className="voyage-sea-map__info-live">AIS {formatAisStampIst(ais.updated)}</span>
          ) : null}
        </aside>
        <div className="voyage-sea-map__legend" aria-hidden>
          <span className="voyage-sea-map__legend-item">
            <i className="voyage-sea-map__legend-dots" />
            Ship Route
          </span>
          <span className="voyage-sea-map__legend-item">
            <MapPin size={14} strokeWidth={2.4} color="#16a34a" />
            Destination
          </span>
        </div>
        <div ref={hostRef} className="voyage-sea-map__canvas" />
        {fetchingAis ? (
          <div className="voyage-sea-map__live-wait" role="status" aria-live="polite">
            <div className="voyage-sea-map__clock" aria-hidden>
              <span className="voyage-sea-map__clock-marks" />
              <span className="voyage-sea-map__clock-hand voyage-sea-map__clock-hand--hour" />
              <span className="voyage-sea-map__clock-hand voyage-sea-map__clock-hand--minute" />
              <span className="voyage-sea-map__clock-hand voyage-sea-map__clock-hand--second" />
              <span className="voyage-sea-map__clock-cap" />
            </div>
            <p>Fetching live data</p>
          </div>
        ) : null}
      </div>
      <div className="voyage-sea-map__footer-wrap">
        {aisKeyword ? (
          <button
            type="button"
            className="voyage-sea-map__fetch-btn"
            aria-label={aisReady ? 'Fetch live vessel data' : 'Fetching live vessel data'}
            disabled={!aisReady}
            onClick={() => fetchLiveAis(true)}
          >
            <RefreshCw size={13} strokeWidth={2.4} className={aisReady ? undefined : 'spin-icon'} aria-hidden />
            {aisReady ? 'Fetch live' : 'Fetching…'}
          </button>
        ) : null}
      <footer className="voyage-sea-map__footer">
        <div className="voyage-sea-map__stat">
          <Ship size={18} strokeWidth={2.2} aria-hidden />
          <span>Distance</span>
          {fetchingAis ? (
            <AisFetchingLabel compact />
          ) : (
            <strong>
              {remainingNm == null
                ? '—'
                : `${remainingNm.toLocaleString('en-US', { maximumFractionDigits: 0 })} NM`}
            </strong>
          )}
        </div>
        <div className="voyage-sea-map__stat voyage-sea-map__stat--dest">
          <Clock size={18} strokeWidth={2.2} aria-hidden />
          <span>Days to Destination</span>
          <strong>{daysUntil == null ? '—' : `${daysUntil} Days`}</strong>
        </div>
        <div className="voyage-sea-map__stat voyage-sea-map__stat--transit">
          <CalendarDays size={18} strokeWidth={2.2} aria-hidden />
          <span>Transit days</span>
          <strong>{transitDays == null ? '—' : `${transitDays} Days`}</strong>
        </div>
        <div className={`voyage-sea-map__stat${liveSpeedKn != null ? ' voyage-sea-map__stat--live' : fetchingAis ? ' voyage-sea-map__stat--fetching' : ''}`}>
          <Gauge size={18} strokeWidth={2.2} aria-hidden />
          <span>Live Speed</span>
          {fetchingAis ? (
            <AisFetchingLabel />
          ) : (
            <strong>{liveSpeedKn == null ? '—' : `${liveSpeedKn.toFixed(1)} kn`}</strong>
          )}
        </div>
        <div className="voyage-sea-map__stat">
          <Route size={18} strokeWidth={2.2} aria-hidden />
          <span>Route</span>
          <strong className="voyage-sea-map__route">
            <b>{fromPort}</b>
            <b>→ {toPort}</b>
          </strong>
        </div>
      </footer>
      </div>
    </div>
  );
}
