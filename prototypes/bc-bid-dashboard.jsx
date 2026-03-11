import { useState, useMemo } from "react";
import { Search, Filter, Clock, Building2, FileText, ChevronDown, ChevronUp, ExternalLink, AlertCircle, TrendingUp, Calendar, Tag, X } from "lucide-react";

const MOCK_DATA = [
  { opportunityId: "OP-2026-0441", status: "Open", description: "Enterprise Cloud Migration Services for Ministry of Health", commodities: ["Information Technology", "Cloud Services"], type: "RFP", issueDate: "2026-03-08", closingDate: "2026-04-15", endsIn: "35 days", amendments: 1, lastUpdated: "2026-03-10", issuedBy: "Ministry of Health", issuedFor: "Ministry of Health", interestedVendorList: true },
  { opportunityId: "OP-2026-0438", status: "Open", description: "Highway 97 Bridge Rehabilitation — Structural Engineering", commodities: ["Construction", "Engineering"], type: "RFQ", issueDate: "2026-03-05", closingDate: "2026-03-28", endsIn: "17 days", amendments: 0, lastUpdated: "2026-03-05", issuedBy: "Ministry of Transportation", issuedFor: "Ministry of Transportation", interestedVendorList: false },
  { opportunityId: "OP-2026-0435", status: "Open", description: "Cybersecurity Audit and Penetration Testing", commodities: ["Information Technology", "Security"], type: "RFP", issueDate: "2026-03-03", closingDate: "2026-04-01", endsIn: "21 days", amendments: 2, lastUpdated: "2026-03-09", issuedBy: "Office of the CIO", issuedFor: "Province of BC", interestedVendorList: true },
  { opportunityId: "OP-2026-0430", status: "Open", description: "Janitorial and Facility Maintenance — Victoria Campus", commodities: ["Facility Management", "Cleaning Services"], type: "RFQ", issueDate: "2026-02-28", closingDate: "2026-03-21", endsIn: "10 days", amendments: 0, lastUpdated: "2026-02-28", issuedBy: "BC Public Service Agency", issuedFor: "BC Public Service Agency", interestedVendorList: false },
  { opportunityId: "OP-2026-0427", status: "Open", description: "GIS Mapping Platform Renewal and Data Integration", commodities: ["Information Technology", "Geospatial"], type: "RFP", issueDate: "2026-02-25", closingDate: "2026-04-10", endsIn: "30 days", amendments: 3, lastUpdated: "2026-03-11", issuedBy: "GeoBC", issuedFor: "Ministry of Forests", interestedVendorList: true },
  { opportunityId: "OP-2026-0422", status: "Closed", description: "Office Furniture Supply — Provincial Government Buildings", commodities: ["Office Supplies", "Furniture"], type: "RFQ", issueDate: "2026-02-10", closingDate: "2026-03-05", endsIn: "Closed", amendments: 0, lastUpdated: "2026-03-06", issuedBy: "Shared Services BC", issuedFor: "Province of BC", interestedVendorList: true },
  { opportunityId: "OP-2026-0419", status: "Open", description: "Indigenous Cultural Safety Training Program Development", commodities: ["Professional Services", "Training"], type: "RFP", issueDate: "2026-02-20", closingDate: "2026-03-31", endsIn: "20 days", amendments: 1, lastUpdated: "2026-03-07", issuedBy: "Ministry of Indigenous Relations", issuedFor: "Ministry of Indigenous Relations", interestedVendorList: false },
  { opportunityId: "OP-2026-0415", status: "Open", description: "Fleet Vehicle Procurement — Electric Vehicles Phase 2", commodities: ["Vehicles", "Transportation"], type: "RFP", issueDate: "2026-02-18", closingDate: "2026-04-05", endsIn: "25 days", amendments: 0, lastUpdated: "2026-02-18", issuedBy: "BC Fleet Services", issuedFor: "Province of BC", interestedVendorList: true },
  { opportunityId: "OP-2026-0411", status: "Closed", description: "Legal Research Database Subscription Renewal", commodities: ["Information Technology", "Legal Services"], type: "RISO", issueDate: "2026-02-01", closingDate: "2026-02-28", endsIn: "Closed", amendments: 0, lastUpdated: "2026-03-01", issuedBy: "Ministry of Attorney General", issuedFor: "Ministry of Attorney General", interestedVendorList: false },
  { opportunityId: "OP-2026-0407", status: "Open", description: "Wildfire Detection Drone Network — Northern Region", commodities: ["Technology", "Emergency Services", "Drones"], type: "RFP", issueDate: "2026-03-01", closingDate: "2026-04-20", endsIn: "40 days", amendments: 0, lastUpdated: "2026-03-01", issuedBy: "BC Wildfire Service", issuedFor: "Ministry of Forests", interestedVendorList: true },
  { opportunityId: "OP-2026-0402", status: "Open", description: "Mental Health Crisis Line — Telephony Infrastructure Upgrade", commodities: ["Telecommunications", "Health Services"], type: "RFP", issueDate: "2026-02-15", closingDate: "2026-03-25", endsIn: "14 days", amendments: 1, lastUpdated: "2026-03-08", issuedBy: "Ministry of Mental Health", issuedFor: "Ministry of Mental Health", interestedVendorList: true },
  { opportunityId: "OP-2026-0398", status: "Closed", description: "Snow Removal Services — Northern Highway Corridors", commodities: ["Transportation", "Maintenance"], type: "RFQ", issueDate: "2026-01-15", closingDate: "2026-02-15", endsIn: "Closed", amendments: 2, lastUpdated: "2026-02-16", issuedBy: "Ministry of Transportation", issuedFor: "Ministry of Transportation", interestedVendorList: true },
];

const STATUS_COLORS = {
  Open: { bg: "rgb(220 252 231)", text: "rgb(21 128 61)", dot: "rgb(34 197 94)" },
  Closed: { bg: "rgb(243 232 225)", text: "rgb(146 109 82)", dot: "rgb(180 140 110)" },
};

const TYPE_COLORS = {
  RFP: { bg: "#1a1a2e", text: "#e0e0ff" },
  RFQ: { bg: "#2e1a1a", text: "#ffe0e0" },
  RISO: { bg: "#1a2e1a", text: "#e0ffe0" },
};

function StatCard({ label, value, icon: Icon, accent }) {
  return (
    <div style={{ background: "#111116", border: "1px solid #222230", borderRadius: 10, padding: "18px 22px", display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ width: 42, height: 42, borderRadius: 8, background: accent + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={20} color={accent} />
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, color: "#f0f0f0", fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.02em" }}>{value}</div>
        <div style={{ fontSize: 12, color: "#777", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      </div>
    </div>
  );
}

function Badge({ children, bg, color }) {
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", background: bg, color, letterSpacing: "0.03em" }}>
      {children}
    </span>
  );
}

function OpportunityRow({ opp, expanded, onToggle }) {
  const sc = STATUS_COLORS[opp.status] || STATUS_COLORS.Open;
  const tc = TYPE_COLORS[opp.type] || TYPE_COLORS.RFP;
  const daysLeft = opp.endsIn === "Closed" ? null : parseInt(opp.endsIn);
  const urgent = daysLeft !== null && daysLeft <= 14;

  return (
    <div style={{ borderBottom: "1px solid #1a1a24" }}>
      <div
        onClick={onToggle}
        style={{ display: "grid", gridTemplateColumns: "90px 1fr 140px 80px 100px 90px 40px", alignItems: "center", padding: "14px 20px", cursor: "pointer", transition: "background 0.15s", background: expanded ? "#0d0d14" : "transparent" }}
        onMouseEnter={e => e.currentTarget.style.background = "#0d0d14"}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
      >
        <div>
          <Badge bg={sc.bg} color={sc.text}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: sc.dot, marginRight: 6, verticalAlign: "middle" }} />
            {opp.status}
          </Badge>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#e8e8ee", lineHeight: 1.4, fontFamily: "'DM Sans', sans-serif" }}>{opp.description}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 3, fontFamily: "'JetBrains Mono', monospace" }}>{opp.opportunityId}</div>
        </div>
        <div style={{ fontSize: 12, color: "#999", fontFamily: "'JetBrains Mono', monospace" }}>{opp.issuedBy}</div>
        <Badge bg={tc.bg} color={tc.text}>{opp.type}</Badge>
        <div style={{ fontSize: 12, color: urgent ? "#ef4444" : "#999", fontWeight: urgent ? 700 : 400, fontFamily: "'JetBrains Mono', monospace" }}>
          {urgent && <AlertCircle size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />}
          {opp.endsIn}
        </div>
        <div style={{ fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono', monospace" }}>{opp.closingDate}</div>
        <div>{expanded ? <ChevronUp size={16} color="#555" /> : <ChevronDown size={16} color="#555" />}</div>
      </div>
      {expanded && (
        <div style={{ padding: "0 20px 18px 110px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Commodities</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {opp.commodities.map((c, i) => <Badge key={i} bg="#18182a" color="#8888bb">{c}</Badge>)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Details</div>
            <div style={{ fontSize: 12, color: "#999", lineHeight: 1.8, fontFamily: "'DM Sans', sans-serif" }}>
              Issued: {opp.issueDate}<br />
              Amendments: {opp.amendments}<br />
              Vendor List: {opp.interestedVendorList ? "Available" : "N/A"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Issued For</div>
            <div style={{ fontSize: 12, color: "#999", fontFamily: "'DM Sans', sans-serif" }}>{opp.issuedFor}</div>
            <a href="#" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 10, fontSize: 12, color: "#6c8cff", textDecoration: "none", fontWeight: 600 }}>
              View on BC Bid <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BCBidDashboard() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [sortField, setSortField] = useState("closingDate");
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const filtered = useMemo(() => {
    let data = [...MOCK_DATA];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(o =>
        o.description.toLowerCase().includes(q) ||
        o.opportunityId.toLowerCase().includes(q) ||
        o.commodities.some(c => c.toLowerCase().includes(q)) ||
        o.issuedBy.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "All") data = data.filter(o => o.status === statusFilter);
    if (typeFilter !== "All") data = data.filter(o => o.type === typeFilter);
    data.sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return data;
  }, [search, statusFilter, typeFilter, sortField, sortAsc]);

  const openCount = MOCK_DATA.filter(o => o.status === "Open").length;
  const urgentCount = MOCK_DATA.filter(o => { const d = parseInt(o.endsIn); return !isNaN(d) && d <= 14; }).length;
  const types = [...new Set(MOCK_DATA.map(o => o.type))];

  return (
    <div style={{ minHeight: "100vh", background: "#08080c", color: "#e8e8ee", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ borderBottom: "1px solid #151520", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: "linear-gradient(135deg, #2a4fff 0%, #6c8cff 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FileText size={16} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>BC Bid Monitor</div>
            <div style={{ fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono', monospace" }}>Government procurement tracker</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: "#34d399", boxShadow: "0 0 8px #34d39966" }} />
          <span style={{ fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono', monospace" }}>Last scraped: 2 min ago</span>
        </div>
      </div>

      <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
          <StatCard label="Total Opportunities" value={MOCK_DATA.length} icon={FileText} accent="#6c8cff" />
          <StatCard label="Open" value={openCount} icon={TrendingUp} accent="#34d399" />
          <StatCard label="Closing Soon (≤14d)" value={urgentCount} icon={AlertCircle} accent="#ef4444" />
          <StatCard label="Organizations" value={[...new Set(MOCK_DATA.map(o => o.issuedBy))].length} icon={Building2} accent="#f59e0b" />
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
            <Search size={15} color="#555" style={{ position: "absolute", left: 12, top: 11 }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search opportunities, IDs, commodities, orgs..."
              style={{ width: "100%", padding: "10px 12px 10px 36px", background: "#111116", border: "1px solid #222230", borderRadius: 8, color: "#e8e8ee", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box" }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: 10, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                <X size={14} color="#555" />
              </button>
            )}
          </div>
          {[{ label: "Status", value: statusFilter, setter: setStatusFilter, options: ["All", "Open", "Closed"] },
            { label: "Type", value: typeFilter, setter: setTypeFilter, options: ["All", ...types] }
          ].map(f => (
            <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Filter size={12} color="#555" />
              <select
                value={f.value}
                onChange={e => f.setter(e.target.value)}
                style={{ padding: "9px 12px", background: "#111116", border: "1px solid #222230", borderRadius: 8, color: "#e8e8ee", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", cursor: "pointer" }}
              >
                {f.options.map(o => <option key={o} value={o}>{f.label}: {o}</option>)}
              </select>
            </div>
          ))}
          <select
            value={`${sortField}-${sortAsc ? "asc" : "desc"}`}
            onChange={e => { const [f, d] = e.target.value.split("-"); setSortField(f); setSortAsc(d === "asc"); }}
            style={{ padding: "9px 12px", background: "#111116", border: "1px solid #222230", borderRadius: 8, color: "#e8e8ee", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", cursor: "pointer" }}
          >
            <option value="closingDate-asc">Closing: Soonest</option>
            <option value="closingDate-desc">Closing: Latest</option>
            <option value="issueDate-desc">Newest First</option>
            <option value="issueDate-asc">Oldest First</option>
            <option value="description-asc">A → Z</option>
          </select>
        </div>

        {/* Results count */}
        <div style={{ fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono', monospace", marginBottom: 10, padding: "0 4px" }}>
          {filtered.length} of {MOCK_DATA.length} opportunities
        </div>

        {/* Table */}
        <div style={{ background: "#0b0b12", border: "1px solid #1a1a24", borderRadius: 10, overflow: "hidden" }}>
          {/* Header row */}
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 140px 80px 100px 90px 40px", padding: "10px 20px", borderBottom: "1px solid #1a1a24", background: "#0a0a10" }}>
            {["Status", "Opportunity", "Organization", "Type", "Ends In", "Closes", ""].map((h, i) => (
              <div key={i} style={{ fontSize: 10, color: "#444", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>{h}</div>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>No opportunities match your filters.</div>
          ) : (
            filtered.map(opp => (
              <OpportunityRow
                key={opp.opportunityId}
                opp={opp}
                expanded={expandedId === opp.opportunityId}
                onToggle={() => setExpandedId(expandedId === opp.opportunityId ? null : opp.opportunityId)}
              />
            ))
          )}
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: "#333", fontFamily: "'JetBrains Mono', monospace", textAlign: "center" }}>
          Data sourced from bcbid.gov.bc.ca via Crawlee scraper · Dashboard refreshes on each scrape run
        </div>
      </div>
    </div>
  );
}
