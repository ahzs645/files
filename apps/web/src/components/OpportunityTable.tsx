import { AlertCircle, ChevronDown, ChevronUp, ExternalLink, LoaderCircle } from "lucide-react";

import type { OpportunityDetail, OpportunityListItem } from "@bcbid/shared";

interface OpportunityTableProps {
  items: OpportunityListItem[];
  expandedProcessId: string | null;
  onToggle: (processId: string | null) => void;
  detail: OpportunityDetail | null | undefined;
  detailLoading: boolean;
}

function Badge({
  children,
  tone
}: {
  children: React.ReactNode;
  tone: "open" | "closed" | "neutral";
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

function statusTone(status: string) {
  return /open/i.test(status) ? "open" : /closed/i.test(status) ? "closed" : "neutral";
}

export function OpportunityTable({
  detail,
  detailLoading,
  expandedProcessId,
  items,
  onToggle
}: OpportunityTableProps) {
  if (items.length === 0) {
    return <div className="empty-state">No opportunities match the current filters.</div>;
  }

  return (
    <div className="table-shell">
      <div className="table-header">
        <span>Status</span>
        <span>Opportunity</span>
        <span>Organization</span>
        <span>Type</span>
        <span>Ends In</span>
        <span>Closes</span>
        <span />
      </div>

      {items.map((item) => {
        const isExpanded = expandedProcessId === item.processId;
        const detailForRow = isExpanded ? detail : null;
        return (
          <div className="table-row" key={item.sourceKey}>
            <button
              className={`row-summary${isExpanded ? " row-summary--expanded" : ""}`}
              onClick={() => onToggle(isExpanded ? null : item.processId)}
              type="button"
            >
              <div>
                <Badge tone={statusTone(item.status)}>{item.status}</Badge>
              </div>
              <div>
                <div className="row-summary__title">{item.description}</div>
                <div className="row-summary__meta">{item.opportunityId}</div>
              </div>
              <div className="row-summary__org">{item.issuedBy ?? "Unknown issuer"}</div>
              <div>
                <Badge tone="neutral">{item.type}</Badge>
              </div>
              <div className="row-summary__countdown">
                {item.endsIn && /(^\d+)|days/i.test(item.endsIn) ? <AlertCircle size={13} /> : null}
                <span>{item.endsIn ?? "N/A"}</span>
              </div>
              <div className="row-summary__meta">{item.closingDate ?? "N/A"}</div>
              <div>{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
            </button>

            {isExpanded ? (
              <div className="row-detail">
                {detailLoading ? (
                  <div className="row-detail__loading">
                    <LoaderCircle className="spin" size={18} />
                    <span>Loading detail...</span>
                  </div>
                ) : detailForRow ? (
                  <div className="row-detail__grid">
                    <section>
                      <h3>Commodities</h3>
                      <div className="chip-list">
                        {detailForRow.commodities.map((commodity) => (
                          <span className="chip" key={commodity}>
                            {commodity}
                          </span>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h3>Opportunity Details</h3>
                      <dl className="field-list">
                        {detailForRow.detailFields.length > 0 ? (
                          detailForRow.detailFields.map((field) => (
                            <div key={`${field.label}-${field.value}`}>
                              <dt>{field.label}</dt>
                              <dd>{field.value}</dd>
                            </div>
                          ))
                        ) : (
                          <div>
                            <dt>Description</dt>
                            <dd>{detailForRow.descriptionText}</dd>
                          </div>
                        )}
                      </dl>
                    </section>

                    <section>
                      <h3>Addenda</h3>
                      {detailForRow.addenda.length > 0 ? (
                        <ul className="link-list">
                          {detailForRow.addenda.map((addendum) => (
                            <li key={`${addendum.title}-${addendum.date ?? "na"}`}>
                              <span>{addendum.title}</span>
                              <small>{addendum.date ?? "Date unavailable"}</small>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted-copy">No addenda were found for this opportunity.</p>
                      )}

                      <h3 className="section-spacer">Attachments</h3>
                      {detailForRow.attachments.length > 0 ? (
                        <ul className="link-list">
                          {detailForRow.attachments.map((attachment) => (
                            <li key={attachment.url}>
                              <a href={attachment.url} target="_blank" rel="noreferrer">
                                {attachment.name} <ExternalLink size={12} />
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted-copy">No public attachments were found.</p>
                      )}

                      {detailForRow.detailUrl ? (
                        <a
                          className="source-link"
                          href={detailForRow.detailUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View on BC Bid <ExternalLink size={12} />
                        </a>
                      ) : null}
                    </section>
                  </div>
                ) : (
                  <div className="muted-copy">Detail data is not available for this opportunity yet.</div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
