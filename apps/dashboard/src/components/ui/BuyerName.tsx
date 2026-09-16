export function BuyerName({ record }: { record: object }) {
  const r = record as Record<string, unknown>;
  const original = String(r.buyerOriginal ?? r.issuingOrganization ?? r.issuedBy ?? 'Unknown buyer');
  const organization = String(r.buyerOrganization ?? original);
  return <span className="block min-w-0 break-words"><span>{organization}</span>{organization !== original && <small className="block text-xs text-text-tertiary">Original: {original || 'Not stated'}</small>}</span>;
}
