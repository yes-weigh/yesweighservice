import type { ZohoDealer } from '../../types/dealers';
import {
  DEALER_FIELD_SECTIONS,
  DEALER_FIELD_SOURCE_LABELS,
  type DealerFieldSource,
  fieldsForSource,
  formatDealerFieldValue,
} from '../../lib/dealerDetailFields';

function SourceBadge({ source }: { source: DealerFieldSource }) {
  return (
    <span className={`dealers-detail__source dealers-detail__source--${source}`}>
      {DEALER_FIELD_SOURCE_LABELS[source]}
    </span>
  );
}

function FieldRow({
  label,
  source,
  value,
}: {
  label: string;
  source: DealerFieldSource;
  value: string;
}) {
  const isMultiline = value.includes('\n');
  return (
    <div className="dealers-detail__data-row">
      <div className="dealers-detail__data-head">
        <span className="dealers-detail__label">{label}</span>
        <SourceBadge source={source} />
      </div>
      {isMultiline ? (
        <pre className="dealers-detail__value dealers-detail__value--code">{value}</pre>
      ) : (
        <span className="dealers-detail__value">{value}</span>
      )}
    </div>
  );
}

export const DealerFullRecord: React.FC<{ dealer: ZohoDealer }> = ({ dealer }) => {
  const extraEntries = Object.entries(dealer.extraFields ?? {});

  return (
    <div className="dealers-detail__record">
      <p className="dealers-detail__record-intro text-muted text-sm">
        Full combined record from Zoho sync, CRM overlay, and local edits — use this to decide
        which fields to keep on the page later.
      </p>

      {DEALER_FIELD_SECTIONS.map(section => {
        const fields = fieldsForSource(section.id);
        return (
          <section key={section.id} className="dealers-detail__record-section">
            <div className="dealers-detail__record-heading">
              <h4>{section.title}</h4>
              <span className="text-muted text-sm">{section.hint}</span>
            </div>
            <div className="dealers-detail__data-grid">
              {fields.map(field => (
                <FieldRow
                  key={field.key}
                  label={field.label}
                  source={field.source}
                  value={formatDealerFieldValue(field.getValue(dealer))}
                />
              ))}
            </div>
          </section>
        );
      })}

      {extraEntries.length > 0 && (
        <section className="dealers-detail__record-section">
          <div className="dealers-detail__record-heading">
            <h4>Other stored fields</h4>
            <span className="text-muted text-sm">Additional keys found in Firestore</span>
          </div>
          <div className="dealers-detail__data-grid">
            {extraEntries.map(([key, value]) => (
              <FieldRow
                key={key}
                label={key}
                source="system"
                value={formatDealerFieldValue(value)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
