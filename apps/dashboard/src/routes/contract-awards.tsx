import { Outlet, createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";

import { ContractAwardsSubnav } from "../components/awards/ContractAwardsSubnav";
import { Card } from "../components/ui/Card";

export const Route = createFileRoute("/contract-awards")({
  component: ContractAwardsLayout,
});
function ContractAwardsLayout() {
  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
          <BarChart3 size={13} />
          <span>Contract Awards</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-text-primary">Contract Awards Intelligence</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage imported awards, inspect the raw records, and analyze suppliers and issuing organizations from the same dataset.
        </p>
      </div>

      <Card>
        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
              Workspace
            </div>
            <div className="mt-2">
              <ContractAwardsSubnav />
            </div>
          </div>
        </div>
      </Card>

      <Outlet />
    </div>
  );
}
