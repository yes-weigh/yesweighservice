import { useEffect, useMemo, useState } from 'react';
import { KERALA_DISTRICT_PATHS, KERALA_MAP_VIEWBOX } from '../../data/keralaDistrictPaths';
import { formatCompactInr, type DistrictSalesRow } from '../../lib/salesByState';

function fillForShare(sales: number, maxSales: number): string {
  if (maxSales <= 0 || sales <= 0) return '#1d4ed8';
  const t = Math.min(1, Math.sqrt(sales / maxSales));
  const r = Math.round(29 + (96 - 29) * t);
  const g = Math.round(78 + (165 - 78) * t);
  const b = Math.round(216 + (250 - 216) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function districtLabelLines(name: string): string[] {
  if (name === 'Thiruvananthapuram') return ['Thiruvanan', 'thapuram'];
  if (name === 'Pathanamthitta') return ['Pathanam', 'thitta'];
  return [name];
}

function formatRank(rank: number | null): string {
  if (rank == null) return '—';
  const mod100 = rank % 100;
  const mod10 = rank % 10;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? 'th'
      : mod10 === 1 ? 'st'
        : mod10 === 2 ? 'nd'
          : mod10 === 3 ? 'rd'
            : 'th';
  return `${rank}${suffix}`;
}

export function KeralaSalesMap({
  rows,
  selectedDistrict,
  focusKey = 0,
  onSelect,
}: {
  rows: DistrictSalesRow[];
  selectedDistrict: string | null;
  focusKey?: number;
  onSelect: (district: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    setHover(null);
  }, [selectedDistrict, focusKey]);

  const byName = useMemo(() => new Map(rows.map(row => [row.district, row])), [rows]);
  const maxSales = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.sales), 0),
    [rows],
  );
  const rankByDistrict = useMemo(() => {
    const ranks = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.sales > 0) ranks.set(row.district, index + 1);
    });
    return ranks;
  }, [rows]);

  const active = hover ?? selectedDistrict;
  const activeRow = active ? byName.get(active) : undefined;
  const totalDealers = activeRow?.dealers ?? 0;
  const activeDealers = activeRow?.activeDealers ?? 0;
  const inactiveDealers = Math.max(0, totalDealers - activeDealers);
  const activeRank = active ? rankByDistrict.get(active) ?? null : null;
  const rankTone =
    activeRank === 1 ? 'gold'
      : activeRank === 2 ? 'silver'
        : activeRank === 3 ? 'bronze'
          : 'slate';
  const paths = useMemo(() => {
    if (!active) return KERALA_DISTRICT_PATHS;
    const rest = KERALA_DISTRICT_PATHS.filter(district => district.name !== active);
    const hot = KERALA_DISTRICT_PATHS.find(district => district.name === active);
    return hot ? [...rest, hot] : KERALA_DISTRICT_PATHS;
  }, [active]);

  return (
    <div className="sales-map__canvas">
      <div className="sales-map__stage sales-map__stage--kerala">
        <svg
          className="sales-map__svg sales-map__svg--kerala"
          viewBox={KERALA_MAP_VIEWBOX}
          role="img"
          aria-label="Kerala sales by district"
          onPointerLeave={() => setHover(null)}
        >
          {paths.map(district => {
            const row = byName.get(district.name);
            const isHot = active === district.name;
            return (
              <g key={district.id}>
                <path
                  d={district.d}
                  fill={isHot ? '#f8fafc' : fillForShare(row?.sales ?? 0, maxSales)}
                  stroke="#ffffff"
                  strokeWidth={isHot ? 2.4 : 1.35}
                  className={`sales-map__state${isHot ? ' is-hot' : ''}`}
                  onClick={() => onSelect(district.name)}
                  onPointerEnter={() => setHover(district.name)}
                  onPointerDown={() => setHover(district.name)}
                />
                <text
                  className={`sales-map__district-label${isHot ? ' is-hot' : ''}`}
                  x={district.labelX}
                  y={district.labelY}
                  textAnchor="middle"
                >
                  {districtLabelLines(district.name).map((line, index) => (
                    <tspan
                      key={line}
                      x={district.labelX}
                      dy={index === 0 ? 0 : 8.5}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>

        {active && (
          <aside key={active} className="sales-map__hover-card" aria-live="polite">
            <p className="sales-map__hover-card-title">
              <span>{active}</span>
              <span className={`sales-map__hover-card-value sales-map__hover-card-value--${rankTone}`}>
                {formatRank(activeRank)}
              </span>
            </p>
            <dl className="sales-map__hover-card-stats">
              <div>
                <dt>Total sales</dt>
                <dd className="sales-map__hover-card-value sales-map__hover-card-value--sales">
                  {formatCompactInr(activeRow?.sales ?? 0)}
                </dd>
              </div>
              <div>
                <dt>Active</dt>
                <dd className="sales-map__hover-card-value sales-map__hover-card-value--dealers">
                  {activeDealers}
                </dd>
              </div>
              <div>
                <dt>Inactive</dt>
                <dd className="sales-map__hover-card-value sales-map__hover-card-value--inactive">
                  {inactiveDealers}
                </dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd className="sales-map__hover-card-value sales-map__hover-card-value--total">
                  {totalDealers}
                </dd>
              </div>
            </dl>
          </aside>
        )}
      </div>
    </div>
  );
}
