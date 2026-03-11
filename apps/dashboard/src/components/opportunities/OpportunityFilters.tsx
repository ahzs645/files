import { startTransition } from "react";
import { Filter, ArrowUpDown } from "lucide-react";
import { SearchInput } from "../ui/SearchInput";
import { Select } from "../ui/Select";

export type SortField = "closingDate" | "issueDate" | "description";
export type SortDirection = "asc" | "desc";

export function OpportunityFilters({
  search,
  onSearchChange,
  status,
  onStatusChange,
  type,
  onTypeChange,
  sortValue,
  onSortChange,
  statusOptions,
  typeOptions,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  type: string;
  onTypeChange: (value: string) => void;
  sortValue: string;
  onSortChange: (value: string) => void;
  statusOptions: string[];
  typeOptions: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SearchInput
        value={search}
        onChange={(v) => startTransition(() => onSearchChange(v))}
        placeholder="Search IDs, descriptions, organizations..."
      />
      <Select
        value={status}
        onChange={onStatusChange}
        icon={Filter}
        options={[
          { value: "All", label: "Status: All" },
          ...statusOptions.map((s) => ({ value: s, label: `Status: ${s}` })),
        ]}
      />
      <Select
        value={type}
        onChange={onTypeChange}
        icon={Filter}
        options={[
          { value: "All", label: "Type: All" },
          ...typeOptions.map((t) => ({ value: t, label: `Type: ${t}` })),
        ]}
      />
      <Select
        value={sortValue}
        onChange={onSortChange}
        icon={ArrowUpDown}
        options={[
          { value: "closingDate:asc", label: "Closing: Soonest" },
          { value: "closingDate:desc", label: "Closing: Latest" },
          { value: "issueDate:desc", label: "Issued: Newest" },
          { value: "issueDate:asc", label: "Issued: Oldest" },
          { value: "description:asc", label: "Description: A-Z" },
        ]}
      />
    </div>
  );
}
