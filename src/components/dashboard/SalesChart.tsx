import React from 'react';

const CHART_POINTS = [42, 58, 52, 71, 68, 84, 92];
const LABELS = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];
const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 16, right: 12, bottom: 28, left: 36 };

function toCoords(values: number[]) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  return values.map((v, i) => {
    const x = PAD.left + (i / (values.length - 1)) * innerW;
    const y = PAD.top + innerH - ((v - min) / range) * innerH;
    return { x, y };
  });
}

export const SalesChart: React.FC = () => {
  const coords = toCoords(CHART_POINTS);
  const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1]!.x} ${HEIGHT - PAD.bottom} L ${coords[0]!.x} ${HEIGHT - PAD.bottom} Z`;

  return (
    <div className="dealer-dash-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="dealer-dash-chart__svg"
        role="img"
        aria-label="Sales trend chart placeholder"
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

        <path d={areaPath} fill="url(#dealerChartFill)" />
        <path
          d={linePath}
          fill="none"
          stroke="url(#dealerChartLine)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {coords.map((p, i) => (
          <g key={LABELS[i]}>
            <circle cx={p.x} cy={p.y} r="5" className="dealer-dash-chart__dot" />
            <circle cx={p.x} cy={p.y} r="9" className="dealer-dash-chart__dot-glow" />
            <text x={p.x} y={HEIGHT - 8} textAnchor="middle" className="dealer-dash-chart__label">
              {LABELS[i]}
            </text>
          </g>
        ))}

        <text x={4} y={PAD.top + 4} className="dealer-dash-chart__axis">20L</text>
        <text x={4} y={HEIGHT - PAD.bottom} className="dealer-dash-chart__axis">0</text>
      </svg>
    </div>
  );
};
