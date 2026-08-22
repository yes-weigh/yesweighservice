import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Clock, Gauge, MapPin, Route, Ship } from 'lucide-react';
import { formatInvoiceDate } from '../../lib/invoices';
import {
  prettyPortName,
  resolveVoyagePorts,
  routeDistanceNm,
  seaRouteWaypoints,
  splitRouteAtProgress,
  voyageDaysUntilEta,
  voyagePlannedSpeedKnots,
  voyageProgressBetweenDates,
} from '../../lib/sea-voyage-route';

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
  etd?: string | null;
  eta?: string | null;
};

export function VoyageSeaMap({
  portOfLoading,
  portOfDischarge,
  vesselName,
  imo,
  etd,
  eta,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const ports = resolveVoyagePorts(portOfLoading, portOfDischarge);
    if (!host || !ports) return;

    const route = seaRouteWaypoints(ports.load, ports.discharge);
    const progress = voyageProgressBetweenDates(etd, eta);
    const { ship, traveled, remaining } = splitRouteAtProgress(route, progress);

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
      weight: 4.5,
      opacity: 0.95,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);

    L.polyline(toLatLngs(remaining), {
      color: '#3b82f6',
      weight: 4,
      opacity: 0.95,
      dashArray: '2 10',
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);

    const polName = escapeMapLabel(prettyPortName(portOfLoading).toUpperCase());
    const podName = escapeMapLabel(prettyPortName(portOfDischarge || 'Cochin').toUpperCase());
    const etdLabel = etd ? escapeMapLabel(`ETD ${formatInvoiceDate(etd)}`) : 'ETD —';
    const etaLabel = eta ? escapeMapLabel(`ETA ${formatInvoiceDate(eta)}`) : 'ETA —';

    L.circleMarker([ports.load.lat, ports.load.lon], {
      radius: 9,
      color: '#fff',
      weight: 2.5,
      fillColor: '#1d4ed8',
      fillOpacity: 1,
    }).addTo(map);
    L.marker([ports.load.lat, ports.load.lon], {
      interactive: false,
      icon: L.divIcon({
        className: 'voyage-sea-map__port-label voyage-sea-map__port-label--pol',
        html: `<div class="voyage-sea-map__port-card"><strong>POL · ${polName}</strong><span>${etdLabel}</span></div>`,
        iconSize: [0, 0],
        iconAnchor: [-12, 10],
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
        iconSize: [0, 0],
        iconAnchor: [-14, 18],
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
  }, [portOfLoading, portOfDischarge, etd, eta]);

  const ports = resolveVoyagePorts(portOfLoading, portOfDischarge);
  if (!ports) {
    return (
      <p className="text-muted text-sm catalog-on-order-dialog__map-empty">
        Add port of loading and port of final discharge to show the sea route.
      </p>
    );
  }

  const route = seaRouteWaypoints(ports.load, ports.discharge);
  const distanceNm = routeDistanceNm(route);
  const daysUntil = voyageDaysUntilEta(eta);
  const speedKn = voyagePlannedSpeedKnots(distanceNm, etd, eta);
  const fromPort = prettyPortName(portOfLoading) || 'POL';
  const toPort = prettyPortName(portOfDischarge || 'Cochin');

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
          {imo ? <span>IMO Number: {imo}</span> : null}
          <span>Next Port: {toPort}</span>
          <span className="voyage-sea-map__info-date">
            ETA {toPort}: {eta ? formatInvoiceDate(eta) : '—'}
          </span>
          <span className="voyage-sea-map__info-date">
            ETD {fromPort}: {etd ? formatInvoiceDate(etd) : '—'}
          </span>
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
      </div>
      <footer className="voyage-sea-map__footer">
        <div className="voyage-sea-map__stat">
          <Ship size={18} strokeWidth={2.2} aria-hidden />
          <span>Total Distance</span>
          <strong>{distanceNm.toLocaleString('en-US', { maximumFractionDigits: 0 })} NM</strong>
        </div>
        <div className="voyage-sea-map__stat">
          <Clock size={18} strokeWidth={2.2} aria-hidden />
          <span>No. of Days</span>
          <strong>{daysUntil == null ? '—' : `${daysUntil} Days`}</strong>
        </div>
        <div className="voyage-sea-map__stat">
          <Gauge size={18} strokeWidth={2.2} aria-hidden />
          <span>Avg. Speed</span>
          <strong>{speedKn == null ? '—' : `${speedKn.toFixed(1)} kn`}</strong>
        </div>
        <div className="voyage-sea-map__stat">
          <Route size={18} strokeWidth={2.2} aria-hidden />
          <span>Route</span>
          <strong>{fromPort} → {toPort}</strong>
        </div>
      </footer>
    </div>
  );
}
