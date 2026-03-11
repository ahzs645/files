import { ExternalLink, FileText, Tag, Paperclip, BookOpen } from "lucide-react";
import type { OpportunityDetail as OpportunityDetailType } from "@bcbid/shared";
import { getOpportunityStatusTone, OPPORTUNITY_TONE_STYLES } from "../../lib/constants";

export function OpportunityDetailView({ detail }: { detail: OpportunityDetailType }) {
  const tone = getOpportunityStatusTone(detail.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider ${OPPORTUNITY_TONE_STYLES[tone]}`}>
            {detail.status}
          </span>
          <span className="inline-flex items-center rounded-full bg-bg-subtle px-2.5 py-1 text-[11px] font-medium text-text-secondary">
            {detail.type}
          </span>
          <span className="text-xs text-text-tertiary">{detail.opportunityId}</span>
        </div>
        <h1 className="text-xl font-bold text-text-primary">{detail.description}</h1>
        {detail.issuedBy ? (
          <p className="text-sm text-text-secondary mt-1">Issued by {detail.issuedBy}</p>
        ) : null}
      </div>

      {/* Key info grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Issue Date", value: detail.issueDate ?? "N/A" },
          { label: "Closing Date", value: detail.closingDate ?? "N/A" },
          { label: "Ends In", value: detail.endsIn ?? "N/A" },
          { label: "Amendments", value: String(detail.amendments) },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-border-subtle bg-bg-subtle p-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary mb-1">{item.label}</div>
            <div className="text-sm font-semibold text-text-primary">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Commodities */}
      {detail.commodities.length > 0 ? (
        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-3">
            <Tag size={14} className="text-accent" />
            Commodities
          </h2>
          <div className="flex flex-wrap gap-2">
            {detail.commodities.map((c) => (
              <span key={c} className="rounded-full border border-border-subtle bg-bg-subtle px-3 py-1 text-xs text-text-secondary">
                {c}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {/* Detail Fields */}
      {detail.detailFields.length > 0 ? (
        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-3">
            <FileText size={14} className="text-accent" />
            Opportunity Details
          </h2>
          <dl className="space-y-2">
            {detail.detailFields.map((field) => (
              <div key={`${field.label}-${field.value}`} className="rounded-lg border border-border-subtle bg-bg-subtle p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">{field.label}</dt>
                <dd className="text-sm text-text-primary mt-1 leading-relaxed">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : detail.descriptionText ? (
        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-3">
            <FileText size={14} className="text-accent" />
            Description
          </h2>
          <p className="rounded-lg border border-border-subtle bg-bg-subtle p-4 text-sm text-text-secondary leading-relaxed">
            {detail.descriptionText}
          </p>
        </section>
      ) : null}

      {/* Addenda */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-3">
          <BookOpen size={14} className="text-accent" />
          Addenda ({detail.addenda.length})
        </h2>
        {detail.addenda.length > 0 ? (
          <div className="space-y-2">
            {detail.addenda.map((addendum) => (
              <div key={`${addendum.title}-${addendum.date}`} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-subtle p-3">
                <div>
                  <div className="text-sm text-text-primary">{addendum.title}</div>
                  <div className="text-xs text-text-tertiary mt-0.5">{addendum.date ?? "Date unavailable"}</div>
                </div>
                {addendum.link ? (
                  <a href={addendum.link} target="_blank" rel="noreferrer" className="text-accent hover:text-accent-strong transition-colors shrink-0">
                    <ExternalLink size={14} />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-tertiary">No addenda found for this opportunity.</p>
        )}
      </section>

      {/* Attachments */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-3">
          <Paperclip size={14} className="text-accent" />
          Attachments ({detail.attachments.length})
        </h2>
        {detail.attachments.length > 0 ? (
          <div className="space-y-2">
            {detail.attachments.map((attachment) => (
              <a
                key={attachment.url}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-subtle p-3 hover:bg-bg-hover transition-colors"
              >
                <span className="text-sm text-accent">{attachment.name}</span>
                <ExternalLink size={14} className="text-text-tertiary shrink-0" />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-tertiary">No public attachments found.</p>
        )}
      </section>

      {/* Source link */}
      {detail.detailUrl ? (
        <div className="pt-2">
          <a
            href={detail.detailUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-accent/20 bg-accent-muted px-4 py-2.5 text-sm font-medium text-accent hover:bg-accent/20 transition-colors"
          >
            View on BC Bid
            <ExternalLink size={14} />
          </a>
        </div>
      ) : null}
    </div>
  );
}
