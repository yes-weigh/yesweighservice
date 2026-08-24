import { useEffect, useMemo, useState } from 'react';
import { INDIA_MAP_VIEWBOX, INDIA_STATE_PATHS } from '../../data/indiaStatePaths';
import { canonicalIndiaState, UNSPECIFIED_STATE } from '../../lib/indiaStates';
import { formatCompactInr, type StateSalesRow } from '../../lib/salesByState';

function officialStateName(name: string): string {
  const canon = canonicalIndiaState(name);
  return canon === UNSPECIFIED_STATE ? name : canon;
}

function fillForShare(sales: number, maxSales: number): string {
  if (maxSales <= 0 || sales <= 0) return '#152238';
  const t = Math.min(1, Math.sqrt(sales / maxSales));
  const r = Math.round(21 + (59 - 21) * t);
  const g = Math.round(64 + (130 - 64) * t);
  const b = Math.round(105 + (246 - 105) * t);
  return `rgb(${r}, ${g}, ${b})`;
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

export function IndiaSalesMap({
  rows,
  selectedState,
  focusKey = 0,
  onSelect,
}: {
  rows: StateSalesRow[];
  selectedState: string | null;
  focusKey?: number;
  onSelect: (state: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    setHover(null);
  }, [selectedState, focusKey]);
  const byName = useMemo(() => new Map(rows.map(row => [row.state, row])), [rows]);
  const maxSales = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.sales), 0),
    [rows],
  );
  const rankByState = useMemo(() => {
    const ranks = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.sales > 0) ranks.set(row.state, index + 1);
    });
    return ranks;
  }, [rows]);

  const active = hover ?? selectedState;
  const activeRow = active ? byName.get(active) : undefined;
  const totalDealers = activeRow?.dealers ?? 0;
  const activeDealers = activeRow?.activeDealers ?? 0;
  const inactiveDealers = Math.max(0, totalDealers - activeDealers);
  const activeRank = active ? rankByState.get(active) ?? null : null;
  const rankTone =
    activeRank === 1 ? 'gold'
      : activeRank === 2 ? 'silver'
        : activeRank === 3 ? 'bronze'
          : 'slate';
  const paths = useMemo(() => {
    if (!active) return INDIA_STATE_PATHS;
    const rest = INDIA_STATE_PATHS.filter(state => officialStateName(state.name) !== active);
    const hot = INDIA_STATE_PATHS.filter(state => officialStateName(state.name) === active);
    return hot.length ? [...rest, ...hot] : INDIA_STATE_PATHS;
  }, [active]);

  return (
    <div className="sales-map__canvas">
      <div className="sales-map__stage">
      <svg
        className="sales-map__svg"
        viewBox={INDIA_MAP_VIEWBOX}
        role="img"
        aria-label="India sales by state"
        onPointerLeave={() => setHover(null)}
      >
        {paths.map(state => {
          const official = officialStateName(state.name);
          const row = byName.get(official);
          const isHot = active === official;
          return (
            <path
              key={state.id}
              d={state.d}
              fill={isHot ? '#f8fafc' : fillForShare(row?.sales ?? 0, maxSales)}
              stroke={isHot ? '#ffffff' : 'rgba(15, 23, 42, 0.85)'}
              strokeWidth={isHot ? 1.85 : 0.45}
              className={`sales-map__state${isHot ? ' is-hot' : ''}`}
              onClick={() => onSelect(official)}
              onPointerEnter={() => setHover(official)}
              onPointerDown={() => setHover(official)}
            />
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
