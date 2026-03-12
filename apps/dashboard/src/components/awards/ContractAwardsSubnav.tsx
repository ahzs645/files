import { Link, useRouterState } from "@tanstack/react-router";
import { BarChart3, Table2 } from "lucide-react";

const items = [
  {
    to: "/contract-awards",
    label: "Browse",
    icon: Table2,
    match: (pathname: string) => pathname === "/contract-awards" || pathname === "/contract-awards/",
  },
  {
    to: "/contract-awards/analysis",
    label: "Analysis",
    icon: BarChart3,
    match: (pathname: string) => pathname.startsWith("/contract-awards/analysis"),
  },
] as const;

export function ContractAwardsSubnav() {
  const router = useRouterState();

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.match(router.location.pathname);

        return (
          <Link
            key={item.to}
            to={item.to}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "border-accent/30 bg-accent-muted text-accent"
                : "border-border-default bg-bg-subtle text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary"
            }`}
          >
            <Icon size={15} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
