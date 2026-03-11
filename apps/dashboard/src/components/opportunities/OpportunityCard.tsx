import { Link } from "@tanstack/react-router";
import { AlertCircle, Calendar, Building2, ArrowRight } from "lucide-react";
import type { OpportunityListItem } from "@bcbid/shared";
import { getOpportunityStatusTone, OPPORTUNITY_TONE_STYLES } from "../../lib/constants";

export function OpportunityCard({ item }: { item: OpportunityListItem }) {
  const tone = getOpportunityStatusTone(item.status);
  const isUrgent = item.endsIn && /^\d+\s*day/i.test(item.endsIn);

  return (
    <Link
      to="/opportunities/$processId"
      params={{ processId: item.processId ?? item.sourceKey }}
      className="group block rounded-xl border border-border-default bg-bg-subtle p-4 hover:border-border-strong hover:bg-bg-hover transition-all duration-150"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider ${OPPORTUNITY_TONE_STYLES[tone]}`}>
          {item.status}
        </span>
        {isUrgent ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-orange">
            <AlertCircle size={12} />
            {item.endsIn}
          </span>
        ) : null}
      </div>

      <h3 className="text-sm font-semibold text-text-primary line-clamp-2 mb-2 group-hover:text-accent transition-colors">
        {item.description}
      </h3>

      <div className="text-xs text-text-tertiary mb-3">{item.opportunityId}</div>

      <div className="space-y-1.5 text-xs text-text-secondary">
        {item.issuedBy ? (
          <div className="flex items-center gap-1.5">
            <Building2 size={12} className="text-text-tertiary shrink-0" />
            <span className="truncate">{item.issuedBy}</span>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <Calendar size={12} className="text-text-tertiary shrink-0" />
          <span>Closes {item.closingDate ?? "N/A"}</span>
        </div>
      </div>

      {item.commodities.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {item.commodities.slice(0, 3).map((c) => (
            <span key={c} className="rounded-full bg-bg-surface px-2 py-0.5 text-[10px] text-text-secondary">
              {c}
            </span>
          ))}
          {item.commodities.length > 3 ? (
            <span className="rounded-full bg-bg-surface px-2 py-0.5 text-[10px] text-text-tertiary">
              +{item.commodities.length - 3}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-subtle">
        <span className="inline-flex items-center rounded-full bg-bg-surface px-2 py-0.5 text-[10px] text-text-secondary">
          {item.type}
        </span>
        <ArrowRight size={14} className="text-text-tertiary group-hover:text-accent transition-colors" />
      </div>
    </Link>
  );
}
