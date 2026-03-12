import { CalendarRange, Filter, Layers3, Users } from "lucide-react";
import type {
  ContractAwardAnalysisDatePreset,
  ContractAwardAnalysisFilters,
} from "@bcbid/shared";

import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";

const presetOptions: { value: ContractAwardAnalysisDatePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "1y", label: "Last 12 months" },
  { value: "3y", label: "Last 3 years" },
  { value: "custom", label: "Custom range" },
];

function FieldLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
      {children}
    </div>
  );
}

export function AnalysisFilterBar({
  filters,
  typeOptions,
  onChange,
  onReset,
}: {
  filters: ContractAwardAnalysisFilters;
  typeOptions: string[];
  onChange: (next: ContractAwardAnalysisFilters) => void;
  onReset: () => void;
}) {
  const datePreset = filters.datePreset ?? "all";

  return (
    <div className="rounded-2xl border border-border-default bg-bg-surface p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-accent">
            <Filter size={13} />
            <span>Analysis Filters</span>
          </div>
          <p className="text-sm text-text-secondary">
            Use the same filter model across the hub and drilldowns so totals, charts, rankings,
            and raw awards stay aligned.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          <div>
            <FieldLabel>Date Window</FieldLabel>
            <Select
              value={datePreset}
              onChange={(value) =>
                onChange({
                  ...filters,
                  datePreset: value as ContractAwardAnalysisDatePreset,
                  fromDate: value === "custom" ? filters.fromDate ?? null : null,
                  toDate: value === "custom" ? filters.toDate ?? null : null,
                })
              }
              options={presetOptions}
              icon={CalendarRange}
            />
          </div>

          <div>
            <FieldLabel>Opportunity Type</FieldLabel>
            <Select
              value={filters.opportunityType ?? "__all__"}
              onChange={(value) =>
                onChange({
                  ...filters,
                  opportunityType: value === "__all__" ? null : value,
                })
              }
              options={[
                { value: "__all__", label: "All types" },
                ...typeOptions.map((option) => ({ value: option, label: option })),
              ]}
              icon={Layers3}
            />
          </div>

          <div>
            <FieldLabel>Minimum Award Value</FieldLabel>
            <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-border-default bg-bg-subtle px-3.5 focus-within:border-accent/30 transition-colors">
              <span className="text-sm text-text-tertiary">$</span>
              <input
                type="number"
                min="0"
                step="5000"
                value={filters.minimumAwardValue ?? ""}
                onChange={(event) =>
                  onChange({
                    ...filters,
                    minimumAwardValue: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
                placeholder="No minimum"
                className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </label>
          </div>

          <div>
            <FieldLabel>Supplier Handling</FieldLabel>
            <Button
              variant="ghost"
              className={`w-full justify-center ${filters.includePlaceholderSuppliers ? "border-accent/30 bg-accent-muted text-accent" : ""}`}
              onClick={() =>
                onChange({
                  ...filters,
                  includePlaceholderSuppliers:
                    !(filters.includePlaceholderSuppliers ?? false),
                })
              }
            >
              <Users size={14} />
              {filters.includePlaceholderSuppliers
                ? "Including placeholders"
                : "Hiding placeholders"}
            </Button>
          </div>
        </div>

        {datePreset === "custom" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <FieldLabel>From Date</FieldLabel>
              <label className="flex min-h-[44px] items-center rounded-xl border border-border-default bg-bg-subtle px-3.5 focus-within:border-accent/30 transition-colors">
                <input
                  type="date"
                  value={filters.fromDate ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...filters,
                      fromDate: event.target.value || null,
                    })
                  }
                  className="w-full bg-transparent text-sm text-text-primary outline-none"
                />
              </label>
            </div>
            <div>
              <FieldLabel>To Date</FieldLabel>
              <label className="flex min-h-[44px] items-center rounded-xl border border-border-default bg-bg-subtle px-3.5 focus-within:border-accent/30 transition-colors">
                <input
                  type="date"
                  value={filters.toDate ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...filters,
                      toDate: event.target.value || null,
                    })
                  }
                  className="w-full bg-transparent text-sm text-text-primary outline-none"
                />
              </label>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onReset}>
            Reset Filters
          </Button>
        </div>
      </div>
    </div>
  );
}
