import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowUpRight } from "lucide-react";
import type { OpportunityListItem } from "@bcbid/shared";
import { getOpportunityStatusTone, OPPORTUNITY_TONE_STYLES } from "../../lib/constants";

export function OpportunityTable({ items }: { items: OpportunityListItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-default text-left">
            <th className="pb-3 pr-4 text-[11px] font-medium uppercase tracking-wider text-text-tertiary w-[100px]">Status</th>
            <th className="pb-3 pr-4 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Opportunity</th>
            <th className="pb-3 pr-4 text-[11px] font-medium uppercase tracking-wider text-text-tertiary hidden md:table-cell">Organization</th>
            <th className="pb-3 pr-4 text-[11px] font-medium uppercase tracking-wider text-text-tertiary hidden lg:table-cell w-[100px]">Type</th>
            <th className="pb-3 pr-4 text-[11px] font-medium uppercase tracking-wider text-text-tertiary hidden sm:table-cell w-[100px]">Ends In</th>
            <th className="pb-3 pr-4 text-[11px] font-medium uppercase tracking-wider text-text-tertiary hidden sm:table-cell w-[110px]">Closes</th>
            <th className="pb-3 text-[11px] font-medium uppercase tracking-wider text-text-tertiary w-[36px]" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const tone = getOpportunityStatusTone(item.status);
            const isUrgent = item.endsIn && /^\d+\s*day/i.test(item.endsIn);
            return (
              <tr key={item.sourceKey} className="group border-b border-border-subtle hover:bg-bg-hover/50 transition-colors">
                <td className="py-3.5 pr-4">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${OPPORTUNITY_TONE_STYLES[tone]}`}>
                    {item.status}
                  </span>
                </td>
                <td className="py-3.5 pr-4">
                  <Link
                    to="/opportunities/$processId"
                    params={{ processId: item.processId ?? item.sourceKey }}
                    className="block"
                  >
                    <div className="font-medium text-text-primary group-hover:text-accent transition-colors line-clamp-1">
                      {item.description}
                    </div>
                    <div className="text-xs text-text-tertiary mt-0.5">{item.opportunityId}</div>
                  </Link>
                </td>
                <td className="py-3.5 pr-4 text-text-secondary text-xs hidden md:table-cell">
                  <span className="line-clamp-1">{item.issuedBy ?? "Unknown"}</span>
                </td>
                <td className="py-3.5 pr-4 hidden lg:table-cell">
                  <span className="inline-flex items-center rounded-full bg-bg-subtle px-2 py-0.5 text-[10px] text-text-secondary">
                    {item.type}
                  </span>
                </td>
                <td className="py-3.5 pr-4 hidden sm:table-cell">
                  <span className={`flex items-center gap-1 text-xs ${isUrgent ? "text-orange font-medium" : "text-text-secondary"}`}>
                    {isUrgent ? <AlertCircle size={12} /> : null}
                    {item.endsIn ?? "N/A"}
                  </span>
                </td>
                <td className="py-3.5 pr-4 text-xs text-text-secondary hidden sm:table-cell">
                  {item.closingDate ?? "N/A"}
                </td>
                <td className="py-3.5">
                  <Link
                    to="/opportunities/$processId"
                    params={{ processId: item.processId ?? item.sourceKey }}
                    className="text-text-tertiary hover:text-accent transition-colors"
                  >
                    <ArrowUpRight size={14} />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
