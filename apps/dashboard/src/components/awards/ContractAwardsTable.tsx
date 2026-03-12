import { useEffect, useRef, useState } from "react";
import type { ContractAwardListItem } from "@bcbid/shared";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

function formatAwardValue(item: ContractAwardListItem): string {
  if (!item.contractValueText) {
    return "N/A";
  }

  return [item.currency, item.contractValueText].filter(Boolean).join(" ");
}

function fallbackText(value: string | null | undefined, fallback = "N/A"): string {
  return value && value.trim() ? value : fallback;
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-subtle p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
        {label}
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary">
        {fallbackText(value)}
      </div>
    </div>
  );
}

function JustificationCell({
  value,
}: {
  value: string | null | undefined;
}) {
  const text = fallbackText(value);

  return (
    <div className="max-w-[260px] text-sm text-text-secondary">
      <div
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function ContractNumberCell({
  value,
}: {
  value: string | null | undefined;
}) {
  const text = fallbackText(value);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    function updateTruncation() {
      const element = textRef.current;
      if (!element) {
        return;
      }

      setIsTruncated(element.scrollWidth > element.clientWidth);
    }

    updateTruncation();

    const element = textRef.current;
    if (typeof ResizeObserver !== "undefined" && element) {
      const observer = new ResizeObserver(() => updateTruncation());
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateTruncation);
    return () => window.removeEventListener("resize", updateTruncation);
  }, [text]);

  return (
    <div className="max-w-[150px] text-text-secondary">
      <div
        ref={textRef}
        className="truncate whitespace-nowrap"
        title={isTruncated ? text : undefined}
      >
        {text}
      </div>
    </div>
  );
}

export function ContractAwardsTable({
  items,
}: {
  items: ContractAwardListItem[];
}) {
  const [selectedItem, setSelectedItem] = useState<ContractAwardListItem | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-bg-surface z-10">
            <tr className="border-b border-border-default text-left">
              <th className="px-3 py-3 font-medium text-text-secondary">Award Date</th>
              <th className="px-3 py-3 font-medium text-text-secondary">Opportunity</th>
              <th className="px-3 py-3 font-medium text-text-secondary">Issuing Organization</th>
              <th className="px-3 py-3 font-medium text-text-secondary">Supplier</th>
              <th className="px-3 py-3 font-medium text-text-secondary">Contract Value</th>
              <th className="px-3 py-3 font-medium text-text-secondary">Contract #</th>
              <th className="px-3 py-3 font-medium text-text-secondary">Justification</th>
              <th className="px-3 py-3 font-medium text-text-secondary">Details</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.importKey}
                className="border-b border-border-subtle align-top transition-colors hover:bg-bg-hover/50"
              >
                <td className="px-3 py-3 text-text-secondary whitespace-nowrap">
                  {fallbackText(item.awardDate)}
                </td>
                <td className="px-3 py-3 min-w-[280px]">
                  <div className="font-medium text-text-primary">
                    {fallbackText(item.opportunityDescription, "Untitled award")}
                  </div>
                  <div className="mt-1 text-xs text-text-tertiary">
                    Opportunity ID: {fallbackText(item.opportunityId)}
                  </div>
                  <div className="mt-1 text-xs text-text-tertiary">
                    Type: {fallbackText(item.opportunityType)}
                  </div>
                </td>
                <td className="px-3 py-3 min-w-[220px] text-text-secondary">
                  {fallbackText(item.issuingOrganization)}
                </td>
                <td className="px-3 py-3 min-w-[220px]">
                  <div className="text-text-primary">
                    {fallbackText(item.successfulSupplier)}
                  </div>
                  <div className="mt-1 text-xs text-text-tertiary">
                    {fallbackText(item.supplierAddress)}
                  </div>
                </td>
                <td className="px-3 py-3 text-text-primary whitespace-nowrap">
                  {formatAwardValue(item)}
                </td>
                <td className="px-3 py-3">
                  <ContractNumberCell value={item.contractNumber} />
                </td>
                <td className="px-3 py-3">
                  <JustificationCell value={item.justification} />
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <Button
                    variant="ghost"
                    className="px-3 py-2 text-xs"
                    onClick={() => setSelectedItem(item)}
                  >
                    View
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={Boolean(selectedItem)}
        title={selectedItem?.opportunityDescription ?? "Contract award details"}
        onClose={() => setSelectedItem(null)}
      >
        {selectedItem ? (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <DetailField label="Opportunity ID" value={selectedItem.opportunityId} />
              <DetailField label="Opportunity Type" value={selectedItem.opportunityType} />
              <DetailField label="Issuing Organization" value={selectedItem.issuingOrganization} />
              <DetailField label="Issuing Location" value={selectedItem.issuingLocation} />
              <DetailField label="Contact Email" value={selectedItem.contactEmail} />
              <DetailField label="Contract Number" value={selectedItem.contractNumber} />
              <DetailField label="Award Date" value={selectedItem.awardDate} />
              <DetailField label="Source File" value={selectedItem.sourceFileName} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <DetailField
                label="Contract Value"
                value={formatAwardValue(selectedItem)}
              />
              <DetailField
                label="Successful Supplier"
                value={selectedItem.successfulSupplier}
              />
            </div>

            <DetailField
              label="Supplier Address"
              value={selectedItem.supplierAddress}
            />
            <DetailField
              label="Justification"
              value={selectedItem.justification}
            />
          </div>
        ) : null}
      </Modal>
    </>
  );
}
