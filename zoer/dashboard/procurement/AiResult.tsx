import { ago, coverageText, fieldLabel, formatField, isEvidence, labelGroup, reviewTitle } from './ai';

export function LabelChips({ labels, limit }: { labels: string[]; limit?: number }) {
  if (!labels.length) return null;
  const shown = limit ? labels.slice(0, limit) : labels;
  return <span className="pc-labels">{shown.map(label => <span key={label} className="pc-label" data-group={labelGroup(label)}><span aria-hidden="true">✦ </span>{label}</span>)}{limit && labels.length > limit && <span className="pc-label" data-group="more">+{labels.length - limit}</span>}</span>;
}

/** One saved AI result, from either the categorizing review or an on-demand evidence run. */
export function AiResult({ review, onCite, docNames = {} }: { review: any; onCite?: (documentId: string, quote: string) => void; docNames?: Record<string, string> }) {
  const result = review.result;
  const evidence = isEvidence(review);
  const fields = Object.entries(result?.fields ?? {}).filter(([key]) => !(evidence && key === 'recommendation'));
  const recommendation = evidence ? result?.fields?.recommendation : undefined;
  const citations = Array.isArray(result?.evidence) ? result.evidence : [];
  const meta = [review.model, ago(review.created_at), coverageText(review)].filter(Boolean).join(' · ');
  return <article className="pc-ai-result" aria-label={reviewTitle(review)}>
    <header><h3>{reviewTitle(review)}{result?.question ? <span className="pc-ai-question">“{result.question}”</span> : null}</h3><p>{meta}</p></header>
    {review.status !== 'succeeded' && <p role="alert">{review.error || `Review ${review.status}.`}</p>}
    {recommendation && <p className="pc-verdict" data-verdict={/no/i.test(String(recommendation)) ? 'no' : 'yes'}>{String(recommendation)}</p>}
    {result?.summary && <p className="pc-ai-summary">{result.summary}</p>}
    {Array.isArray(result?.labels) && <LabelChips labels={result.labels} />}
    {fields.length > 0 && <dl className="pc-ai-fields">{fields.map(([key, value]) => { const text = formatField(key, value); return <div key={key}><dt>{fieldLabel(key)}</dt><dd>{Array.isArray(text) ? <ul>{text.map((line, i) => <li key={i}>{line}</li>)}</ul> : text}</dd></div>; })}</dl>}
    {citations.length > 0 && <div className="pc-citations"><h4>Evidence</h4>{citations.map((citation: any, index: number) => {
      const documentId = citation.version?.documentId, name = citation.version?.name || docNames[documentId] || 'Notice record';
      return <blockquote key={index}>{citation.quote || 'No quotation recorded.'}<footer>{name}{documentId && onCite && <> · <button type="button" onClick={() => onCite(documentId, citation.quote ?? '')}>Show in document</button></>}</footer></blockquote>;
    })}</div>}
    {result?.unverifiedEvidenceCount > 0 && <p role="alert">{result.unverifiedEvidenceCount} quote(s) couldn’t be matched to the source text.</p>}
  </article>;
}
