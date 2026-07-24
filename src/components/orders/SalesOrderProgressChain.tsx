import {
  getUnifiedOrderProgress,
  type UnifiedSalesOrderRow,
} from '../../lib/unified-sales-orders';

export function SalesOrderProgressChain({
  row,
  compact = false,
}: {
  row: UnifiedSalesOrderRow;
  compact?: boolean;
}) {
  const progress = getUnifiedOrderProgress(row);

  return (
    <div
      className={[
        'so-progress',
        `so-progress--${progress.tone}`,
        compact ? 'so-progress--compact' : '',
      ].filter(Boolean).join(' ')}
      role="img"
      aria-label={`Progress: ${progress.currentLabel}`}
    >
      {progress.steps.map((step, index) => (
        <div
          key={step.id}
          className={`so-progress__step so-progress__step--${step.state}`}
        >
          {index > 0 && <span className="so-progress__rail" aria-hidden />}
          <span className="so-progress__node" aria-hidden>
            <span className="so-progress__dot" />
          </span>
          <span className="so-progress__label">{step.label}</span>
        </div>
      ))}
    </div>
  );
}
