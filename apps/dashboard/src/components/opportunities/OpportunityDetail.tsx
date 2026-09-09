import type { ReactNode } from "react";
import { ExternalLink, FileText, Tag, Paperclip, BookOpen, Contact, CalendarDays } from "lucide-react";
import type { OpportunityDetail as OpportunityDetailType, OpportunityField } from "@bcbid/shared";
import { getOpportunityStatusTone, OPPORTUNITY_TONE_STYLES } from "../../lib/constants";
import "./opportunity-detail.css";

const normalizedLabel = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function FieldList({ fields, compact = false }: { fields: OpportunityField[]; compact?: boolean }) {
  return <dl className={`bid-detail-fields${compact ? " bid-detail-fields-compact" : ""}`}>
    {fields.map((field, index) => <div key={`${field.label}-${index}`}>
      <dt>{field.label}</dt>
      <dd>{/email/i.test(field.label) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value)
        ? <a href={`mailto:${field.value}`}>{field.value}</a>
        : field.value || "Not provided"}</dd>
    </div>)}
  </dl>;
}

export function OpportunityDetailView({ detail, actions }: { detail: OpportunityDetailType; actions?: ReactNode }) {
  const tone = getOpportunityStatusTone(detail.status);
  const findField = (labels: string[]) => detail.detailFields.find(field => labels.includes(normalizedLabel(field.label)))?.value;
  const summaryFields = detail.detailFields.filter(field => /^(summary details|summary|scope|scope of work|description)$/i.test(field.label.trim()));
  const submissionFields = detail.detailFields.filter(field => /submission|delivery|enquir|inquir|mandatory|meeting|site visit/i.test(field.label));
  const contactFields = detail.detailFields.filter(field => /contact|address|region|postal|province|city|telephone|fax/i.test(field.label) && !submissionFields.includes(field));
  const summary = summaryFields.length ? summaryFields : detail.descriptionText && detail.descriptionText !== detail.description
    ? [{ label: "Summary", value: detail.descriptionText }] : [];
  const sourceFields = [...detail.detailFields];
  if (detail.descriptionText?.trim() && detail.descriptionText.trim() !== detail.description.trim()
    && !sourceFields.some(field => field.value.trim() === detail.descriptionText.trim())) {
    sourceFields.push({ label: "Captured description", value: detail.descriptionText });
  }
  const facts = [
    { label: "Issued", value: findField(["issue date"]) || detail.issueDate || "Not provided" },
    { label: "Closes", value: findField(["closing date and time", "closing date"]) || detail.closingDate || "Not provided" },
    { label: "Amendments", value: findField(["amendment", "amendment number"]) || String(detail.amendments) },
    ...(findField(["lot", "lot number"]) ? [{ label: "Lot", value: findField(["lot", "lot number"])! }] : []),
  ];

  return <article className="bid-opportunity-detail">
    <header className="bid-detail-header">
      <div className="bid-detail-heading">
        <div className="bid-detail-badges">
          <span className={`bid-detail-status ${OPPORTUNITY_TONE_STYLES[tone]}`}>{detail.status}</span>
          <span>{detail.type}</span>
          <span>ID {detail.opportunityId}</span>
        </div>
        <h1>{detail.description}</h1>
        {detail.issuedBy && <p>{detail.issuedBy}</p>}
      </div>
      <div className="bid-detail-actions">
        {actions}
        {detail.detailUrl && <a href={detail.detailUrl} target="_blank" rel="noreferrer" className="bid-detail-source">View on BC Bid <ExternalLink size={14} /></a>}
      </div>
    </header>

    <section className="bid-detail-section bid-detail-key-facts" aria-label="Key dates and reference numbers">
      <h2><CalendarDays size={16} /> Key facts</h2>
      <FieldList fields={facts} compact />
    </section>

    <div className="bid-detail-columns">
      <div className="bid-detail-main">
        <section className="bid-detail-section">
          <h2><FileText size={16} /> Summary</h2>
          {summary.length ? <div className="bid-detail-prose">{summary.map((field, index) => <div key={`${field.label}-${index}`}>
            {summary.length > 1 && <h3>{field.label}</h3>}
            <p>{field.value}</p>
          </div>)}</div> : <p className="bid-detail-muted">No additional summary has been captured. Open the source to check the full notice.</p>}
        </section>

        {submissionFields.length > 0 && <section className="bid-detail-section">
          <h2><FileText size={16} /> Submission requirements</h2>
          <FieldList fields={submissionFields} />
        </section>}

        <section className="bid-detail-section">
          <h2><Paperclip size={16} /> Documents <span className="bid-detail-count">{detail.attachments.length}</span></h2>
          {detail.attachments.length > 0 ? <ul className="bid-detail-documents">{detail.attachments.map((attachment, index) => <li key={`${attachment.url}-${index}`}>
            <a href={attachment.url} target="_blank" rel="noreferrer"><Paperclip size={16} /><span>{attachment.name}</span><ExternalLink size={14} /></a>
          </li>)}</ul> : <p className="bid-detail-muted">No public attachments captured.</p>}
        </section>

        <section className="bid-detail-section">
          <h2><BookOpen size={16} /> Addenda <span className="bid-detail-count">{detail.addenda.length}</span></h2>
          {detail.addenda.length > 0 ? <ul className="bid-detail-documents">{detail.addenda.map((addendum, index) => <li key={`${addendum.title}-${index}`}>
            <div className="bid-detail-addendum"><div><p>{addendum.title}</p><span className="bid-detail-muted">{addendum.date || "Date unavailable"}</span></div>
              {addendum.link && <a href={addendum.link} target="_blank" rel="noreferrer" aria-label={`Open ${addendum.title}`}><ExternalLink size={16} /></a>}
            </div>
          </li>)}</ul> : <p className="bid-detail-muted">No addenda captured for this opportunity.</p>}
        </section>
      </div>

      <aside className="bid-detail-sidebar" aria-label="Contact and classification">
        <section className="bid-detail-section">
          <h2><Contact size={16} /> Contacts & location</h2>
          {contactFields.length ? <FieldList fields={contactFields} /> : <p className="bid-detail-muted">No contact details have been captured.</p>}
        </section>
        {detail.commodities.length > 0 && <section className="bid-detail-section">
          <h2><Tag size={16} /> Commodities</h2>
          <ul className="bid-detail-commodities">{detail.commodities.map((commodity, index) => <li key={`${commodity}-${index}`}>{commodity}</li>)}</ul>
        </section>}
        <section className="bid-detail-section">
          <h2>Source snapshot</h2>
          <FieldList fields={[
            { label: "Captured", value: detail.sourceCapturedAt || "Not available" },
            ...(detail.endsIn ? [{ label: "Time remaining at capture", value: detail.endsIn }] : []),
            ...(detail.issuedFor ? [{ label: "Issued for", value: detail.issuedFor }] : []),
          ]} />
        </section>
      </aside>
    </div>

    {sourceFields.length > 0 && <details className="bid-detail-section bid-detail-source-fields" data-zoer-disclosure>
      <summary>All source fields <span className="bid-detail-count">{sourceFields.length}</span></summary>
      <p className="bid-detail-muted">The complete labels and values captured from BC Bid, including fields summarized above.</p>
      <FieldList fields={sourceFields} compact />
    </details>}
  </article>;
}
