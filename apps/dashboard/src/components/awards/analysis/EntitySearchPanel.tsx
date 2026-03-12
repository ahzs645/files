import { Link } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useState } from "react";
import { useAction } from "convex/react";
import type { ContractAwardEntityOption } from "@bcbid/shared";

import { api } from "@convex/_generated/api";
import { Card } from "../../ui/Card";
import { SearchInput } from "../../ui/SearchInput";
import {
  formatCompactNumber,
  formatCount,
  formatCurrency,
} from "../../../lib/formatting";

function SearchBox({
  title,
  kind,
  includePlaceholderSuppliers,
}: {
  title: string;
  kind: "supplier" | "organization";
  includePlaceholderSuppliers: boolean;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const runEntityOptions = useAction(api.contractAwardsAnalysis.entityOptions);
  const [options, setOptions] = useState<ContractAwardEntityOption[] | undefined>(
    undefined,
  );
  const query = deferredSearch.trim();

  useEffect(() => {
    let cancelled = false;

    if (query.length < 2) {
      setOptions(undefined);
      return () => {
        cancelled = true;
      };
    }

    setOptions(undefined);

    void runEntityOptions({
      kind,
      search: query,
      includePlaceholderSuppliers,
    })
      .then((result) => {
        if (!cancelled) {
          setOptions(result as ContractAwardEntityOption[]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOptions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [includePlaceholderSuppliers, kind, query, runEntityOptions]);

  return (
    <Card className="h-full">
      <div className="space-y-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-accent">
            Jump To {title}
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            Search by name to open a drilldown page directly.
          </p>
        </div>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={`Search ${title.toLowerCase()}...`}
        />

        {query.length < 2 ? (
          <div className="rounded-xl border border-dashed border-border-default px-4 py-6 text-sm text-text-tertiary">
            Type at least two characters to search.
          </div>
        ) : options === undefined ? (
          <div className="rounded-xl border border-dashed border-border-default px-4 py-6 text-sm text-text-tertiary">
            Loading matches...
          </div>
        ) : options.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-default px-4 py-6 text-sm text-text-tertiary">
            No matches found.
          </div>
        ) : (
          <div className="space-y-2">
            {options.map((option) => (
              <Link
                key={option.key}
                to={
                  kind === "supplier"
                    ? "/contract-awards/analysis/suppliers/$supplierKey"
                    : "/contract-awards/analysis/organizations/$organizationKey"
                }
                params={
                  kind === "supplier"
                    ? { supplierKey: option.key }
                    : { organizationKey: option.key }
                }
                className="block rounded-xl border border-border-subtle bg-bg-subtle px-4 py-3 transition-colors hover:border-border-strong hover:bg-bg-hover"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {option.label}
                    </div>
                    <div className="mt-1 text-xs text-text-tertiary">
                      {formatCount(option.awardCount)} awards · {formatCompactNumber(option.totalValue)} total value
                    </div>
                  </div>
                  <div className="shrink-0 text-sm text-text-secondary">
                    {formatCurrency(option.totalValue, { compact: true })}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function EntitySearchPanel({
  includePlaceholderSuppliers,
}: {
  includePlaceholderSuppliers: boolean;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SearchBox
        title="Suppliers"
        kind="supplier"
        includePlaceholderSuppliers={includePlaceholderSuppliers}
      />
      <SearchBox
        title="Issuing Organizations"
        kind="organization"
        includePlaceholderSuppliers={includePlaceholderSuppliers}
      />
    </div>
  );
}
