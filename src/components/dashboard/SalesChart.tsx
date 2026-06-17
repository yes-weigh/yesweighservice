import React from 'react';
import type { InvoiceWeeklySales } from '../../types/invoices';

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 16, right: 12, bottom: 28, left: 36 };

function toCoords(values: number[]) {
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const divisor = values.length > 1 ? values.length - 1 : 1;

  return values.map((v, i) => {
    const x = PAD.left + (i / divisor) * innerW;
    const y = PAD.top + innerH - ((v - min) / range) * innerH;
    return { x, y };
  });
}

function formatAxisValue(value: number): string {
  if (value >= 100000) return `${Math.round(value / 100000)}L`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(Math.round(value));
}

interface SalesChartProps {
  weeklySales?: InvoiceWeeklySales[];
}

export const SalesChart: React.FC<SalesChartProps> = ({ weeklySales = [] }) => {
  const values = weeklySales.map(w => w.total);
  const labels = weeklySales.map(w => w.label);
  const hasData = values.some(v => v > 0);

  if (!weeklySales.length) {
    return (
      <div className="dealer-dash-chart dealer-dash-chart--empty">
        <p className="dealer-dash-chart__empty">No invoice data yet.</p>
      </div>
    );
  }

  const coords = toCoords(values);
  const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1]!.x} ${HEIGHT - PAD.bottom} L ${coords[0]!.x} ${HEIGHT - PAD.bottom} Z`;
  const maxValue = Math.max(...values, 0);

  return (
    <div className="dealer-dash-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="dealer-dash-chart__svg"
        role="img"
        aria-label="Weekly invoice totals chart"
      >
        <defs>
          <linearGradient id="dealerChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(59, 130, 246, 0.35)" />
            <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
          </linearGradient>
          <linearGradient id="dealerChartLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>

        {[0, 25, 50, 75, 100].map(pct => {
          const y = PAD.top + ((100 - pct) / 100) * (HEIGHT - PAD.top - PAD.bottom);
          return (
            <line
              key={pct}
              x1={PAD.left}
              y1={y}
              x2={WIDTH - PAD.right}
              y2={y}
              className="dealer-dash-chart__grid"
            />
          );
        })}

        {hasData && (
          <>
            <path d={areaPath} fill="url(#dealerChartFill)" />
            <path
              d={linePath}
              fill="none"
              stroke="url(#dealerChartLine)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {coords.map((p, i) => (
          <g key={`${labels[i]}-${i}`}>
            {hasData && values[i]! > 0 && (
              <>
                <circle cx={p.x} cy={p.y} r="5" className="dealer-dash-chart__dot" />
                <circle cx={p.x} cy={p.y} r="9" className="dealer-dash-chart__dot-glow" />
              </>
            )}
            <text x={p.x} y={HEIGHT - 8} textAnchor="middle" className="dealer-dash-chart__label">
              {labels[i]}
            </text>
          </g>
        ))}

        {hasData && maxValue > 0 && (
          <text x={4} y={PAD.top + 4} className="dealer-dash-chart__axis">
            {formatAxisValue(maxValue)}
          </text>
        )}
        <text x={4} y={HEIGHT - PAD.bottom} className="dealer-dash-chart__axis">0</text>
      </svg>
      {!hasData && (
        <p className="dealer-dash-chart__empty-inline">No sales in the last 7 weeks.</p>
      )}
    </div>
  );
};
