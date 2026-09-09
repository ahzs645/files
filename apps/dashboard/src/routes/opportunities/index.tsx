import { BidPreferences } from '../../components/preferences/BidPreferences';
import { Button } from '../../components/ui/Button';
import { createFileRoute } from "@tanstack/react-router";
import { useContext, useEffect, useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { LayoutGrid, List } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { OpportunityListItem } from "@bcbid/shared";
import { Card, CardHeader } from "../../components/ui/Card";
import {
  OpportunityFilters,
  type SortField,
  type SortDirection,
} from "../../components/opportunities/OpportunityFilters";
import { OpportunityTable } from "../../components/opportunities/OpportunityTable";
import { OpportunityCard } from "../../components/opportunities/OpportunityCard";
import { EmptyState } from "../../components/opportunities/EmptyState";
import { Spinner } from "../../components/ui/Spinner";

export const Route = createFileRoute("/opportunities/")({
  component: OpportunitiesPage,
});

function compareValues(
  left: OpportunityListItem,
  right: OpportunityListItem,
  field: SortField,
  direction: SortDirection,
) {
  const leftValue = left[field] ?? "";
  const rightValue = right[field] ?? "";
  const result = String(leftValue).localeCompare(String(rightValue));
  return direction === "asc" ? result : result * -1;
}

function OpportunitiesPage() {
  const { opportunitiesView } = useContext(BidPreferences);
  return opportunitiesView ?? <StandaloneOpportunitiesPage />;
}
function StandaloneOpportunitiesPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState("All");
  const [type, setType] = useState("All");
  const [sortField, setSortField] = useState<SortField>("closingDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");

  const [cursor, setCursor] = useState<string | null>(null);
  const { onlyStarred } = useContext(BidPreferences);
  useEffect(() => setCursor(null), [deferredSearch, status, type, onlyStarred]);
  const summary = useQuery(api.dashboard.summary, {});
  const listResponse = useQuery(api.opportunities.list, {
    search: deferredSearch || undefined,
    status: status === "All" ? undefined : status,
    type: type === "All" ? undefined : type,
    limit: 200,
    cursor,
  });

  const sortedItems = useMemo(() => {
    const items = [...(listResponse?.items ?? [])];
    items.sort((left, right) =>
      compareValues(left, right, sortField, sortDirection),
    );
    return items;
  }, [listResponse?.items, sortDirection, sortField]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Opportunities
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {listResponse
              ? `${listResponse.total} procurement opportunities`
              : "Loading..."}
          </p>
        </div>
        {/* View toggle */}
        <div className="flex items-center rounded-lg border border-border-default bg-bg-subtle">
          <button
            type="button"
            onClick={() => setViewMode("table")}
            className={`rounded-lg p-2 transition-colors ${viewMode === "table" ? "bg-accent-muted text-accent" : "text-text-tertiary hover:text-text-primary"}`}
            title="Table view"
          >
            <List size={16} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("cards")}
            className={`rounded-lg p-2 transition-colors ${viewMode === "cards" ? "bg-accent-muted text-accent" : "text-text-tertiary hover:text-text-primary"}`}
            title="Card view"
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <OpportunityFilters
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={setStatus}
        type={type}
        onTypeChange={setType}
        sortValue={`${sortField}:${sortDirection}`}
        onSortChange={(value) => {
          const [field, direction] = value.split(":") as [
            SortField,
            SortDirection,
          ];
          setSortField(field);
          setSortDirection(direction);
        }}
        statusOptions={summary?.statusOptions ?? []}
        typeOptions={summary?.typeOptions ?? []}
      />

      {listResponse && <div className="zoer-record-tools"><Button variant="ghost" disabled={!cursor} onClick={() => setCursor(String(Math.max(0, Number(cursor) - 200)))}>Previous</Button><span>Page {Math.floor(Number(cursor) / 200) + 1}</span><Button variant="ghost" disabled={!listResponse.nextCursor} onClick={() => setCursor(listResponse.nextCursor)}>Next</Button></div>}
      {/* Results */}
      {!listResponse ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={24} />
        </div>
      ) : sortedItems.length === 0 ? (
        <EmptyState />
      ) : viewMode === "table" ? (
        <Card padding={false}>
          <div className="p-5">
            <OpportunityTable items={sortedItems} />
          </div>
        </Card>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sortedItems.map((item) => (
            <OpportunityCard key={item.sourceKey} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
