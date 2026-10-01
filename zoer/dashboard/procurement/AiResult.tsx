import { ago, coverageText, fieldLabel, formatField, isEvidence, labelGroup, reviewTitle, verdictText, verdictTone } from './ai';
import { checkFields, formatTyped, parsePrompt } from '../review-fields';

export function LabelChips({ labels, limit }: { labels: string[]; limit?: number }) {
  if (!labels.length) return null;
  const shown = limit ? labels.slice(0, limit) : labels;
  return <span className="pc-labels">{shown.map(label => <span key={label} className="pc-label" data-group={labelGroup(label)}><span aria-hidden="true">✦ </span>{label}</span>)}{limit && labels.length > limit && <span className="pc-label" data-group="more">+{labels.length - limit}</span>}</span>;
}

const Lines = ({ text }: { text: string | string[] }) => Array.isArray(text) ? <ul>{text.map((line, i) => <li key={i}>{line}</li>)}</ul> : <>{text}</>;

/** One saved AI result, from either the categorizing review or an on-demand evidence run. */
export function AiResult({ review, onCite, docNames = {} }: { review: any; onCite?: (documentId: string, quote: string) => void; docNames?: Record<string, string> }) {
  const result = review.result;
  const evidence = isEvidence(review);
  const fields = Object.entries(result?.fields ?? {}).filter(([key]) => !(evidence && key === 'recommendation'));
  const recommendation = evidence ? result?.fields?.recommendation : undefined;
  const citations = Array.isArray(result?.evidence) ? result.evidence : [];
  const spec = evidence ? [] : parsePrompt(result?.prompt?.instructions).fields;
  const typed = spec.length ? checkFields(spec, result?.fields) : null;
  const meta = [review.model, ago(review.created_at), coverageText(review)].filter(Boolean).join(' · ');
  return <article className="pc-ai-result" aria-label={reviewTitle(review)}>
    <header><h3>{reviewTitle(review)}{result?.question ? <span className="pc-ai-question">“{result.question}”</span> : null}</h3><p>{meta}</p></header>
    {review.status !== 'succeeded' && <p role="alert">{review.error || `Review ${review.status}.`}</p>}
    {recommendation != null && recommendation !== '' && <p className="pc-verdict" data-verdict={verdictTone(recommendation)}>{verdictText(recommendation)}</p>}
    {result?.summary && <p className="pc-ai-summary">{result.summary}</p>}
    {Array.isArray(result?.labels) && <LabelChips labels={result.labels} />}
    {typed ? <dl className="pc-ai-fields">{typed.checks.map(({ field, value, state, note }) => <div key={field.key} data-state={state}><dt>{field.label}</dt><dd><Lines text={formatTyped(field, value)} />{note && state !== 'missing' && <small className="pc-field-problem">{note}</small>}</dd></div>)}</dl>
      : fields.length > 0 && <dl className="pc-ai-fields">{fields.map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd><Lines text={formatField(key, value)} /></dd></div>)}</dl>}
    {typed && typed.extra.length > 0 && <p className="pc-card-meta">Also returned fields not in the prompt: {typed.extra.join(', ')}</p>}
    {citations.length > 0 && <div className="pc-citations"><h4>Evidence</h4>{citations.map((citation: any, index: number) => {
      const documentId = citation.version?.documentId, name = citation.version?.name || docNames[documentId] || 'Notice record';
      return <blockquote key={index}>{citation.quote || 'No quotation recorded.'}<footer>{name}{documentId && onCite && <> · <button type="button" onClick={() => onCite(documentId, citation.quote ?? '')}>Show in document</button></>}</footer></blockquote>;
    })}</div>}
    {result?.unverifiedEvidenceCount > 0 && <p role="alert">{result.unverifiedEvidenceCount} quote(s) couldn’t be matched to the source text.</p>}
  </article>;
}
