import { type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, FileText, Radio, History } from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/opportunities", label: "Opportunities", icon: FileText },
  { to: "/scraper", label: "Scraper", icon: Radio },
  { to: "/scraper/history", label: "Run History", icon: History },
] as const;

function NavLink({ to, label, icon: Icon }: (typeof navItems)[number]) {
  const router = useRouterState();
  const isActive =
    to === "/"
      ? router.location.pathname === "/"
      : router.location.pathname.startsWith(to);

  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        isActive
          ? "bg-accent-muted text-accent"
          : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
      }`}
    >
      <Icon size={16} />
      <span>{label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-[240px] shrink-0 flex-col border-r border-border-default bg-bg-surface-strong/50 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15">
            <Radio size={16} className="text-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold text-text-primary">BC Bid</div>
            <div className="text-[11px] text-text-tertiary">Monitor</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {navItems.map((item) => (
            <NavLink key={item.to} {...item} />
          ))}
        </nav>

        <div className="border-t border-border-default px-5 py-4">
          <div className="text-[11px] text-text-tertiary">
            BC Bid Procurement Monitor
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="lg:hidden flex items-center justify-between border-b border-border-default bg-bg-surface-strong/50 backdrop-blur-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <Radio size={16} className="text-accent" />
            <span className="text-sm font-semibold">BC Bid Monitor</span>
          </div>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-lg p-2 text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                  title={item.label}
                >
                  <Icon size={18} />
                </Link>
              );
            })}
          </nav>
        </header>

        {/* Main content area */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-5 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
