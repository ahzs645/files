import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Card } from "../../components/ui/Card";
import { OpportunityDetailView } from "../../components/opportunities/OpportunityDetail";
import { Spinner } from "../../components/ui/Spinner";

export const Route = createFileRoute("/opportunities/$processId")({
  component: OpportunityDetailPage,
});

function OpportunityDetailPage() {
  const { processId } = Route.useParams();
  const detail = useQuery(api.opportunities.getByProcessId, { processId });

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        to="/opportunities"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Opportunities
      </Link>

      {detail === undefined ? (
        <div className="flex items-center justify-center py-32">
          <Spinner size={24} />
        </div>
      ) : detail === null ? (
        <Card>
          <div className="py-16 text-center">
            <p className="text-text-secondary">
              Opportunity not found for process ID: {processId}
            </p>
            <Link
              to="/opportunities"
              className="mt-4 inline-flex items-center gap-2 text-sm text-accent hover:text-accent-strong transition-colors"
            >
              <ArrowLeft size={14} />
              Return to catalog
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <OpportunityDetailView detail={detail} />
        </Card>
      )}
    </div>
  );
}
