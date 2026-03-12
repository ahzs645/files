export type ScrapeTrigger = "manual" | "scheduled";
export type ScrapeRunStatus = "running" | "stopping" | "succeeded" | "failed" | "cancelled";
export type ScrapeRunPhase =
  | "queued"
  | "booting"
  | "listing"
  | "detail"
  | "ingesting"
  | "stopping"
  | "complete"
  | "failed"
  | "cancelled";

export interface OpportunityField {
  label: string;
  value: string;
}

export interface OpportunityAttachment {
  name: string;
  url: string;
}

export interface OpportunityAddendum {
  title: string;
  date: string | null;
  link: string | null;
}

export interface OpportunityListing {
  sourceKey: string;
  processId: string | null;
  opportunityId: string;
  status: string;
  description: string;
  listingUrl: string | null;
  detailUrl: string | null;
  commodities: string[];
  type: string;
  issueDate: string | null;
  closingDate: string | null;
  endsIn: string | null;
  amendments: number;
  lastUpdated: string | null;
  issuedBy: string | null;
  issuedFor: string | null;
  interestedVendorList: boolean;
  sourceCapturedAt: string;
}

export interface OpportunityDetailScrape {
  processId: string | null;
  detailUrl: string | null;
  descriptionText: string;
  detailFields: OpportunityField[];
  addenda: OpportunityAddendum[];
  attachments: OpportunityAttachment[];
  sourceCapturedAt: string;
}

export interface OpportunityRecord extends OpportunityListing {
  descriptionText: string;
  detailFields: OpportunityField[];
  addenda: OpportunityAddendum[];
  attachments: OpportunityAttachment[];
  searchText: string;
}

export interface OpportunityListItem {
  sourceKey: string;
  processId: string | null;
  opportunityId: string;
  status: string;
  description: string;
  commodities: string[];
  type: string;
  issueDate: string | null;
  closingDate: string | null;
  endsIn: string | null;
  amendments: number;
  lastUpdated: string | null;
  issuedBy: string | null;
  issuedFor: string | null;
  interestedVendorList: boolean;
  detailUrl: string | null;
}

export interface OpportunityDetail extends OpportunityRecord {}

export interface OpportunityFilters {
  search?: string;
  status?: string;
  type?: string;
  issuedBy?: string;
  closingBefore?: string;
  cursor?: string | null;
  limit?: number;
}

export interface ContractAwardImportRecord {
  opportunityId: string | null;
  opportunityDescription: string;
  opportunityType: string | null;
  issuingOrganization: string | null;
  issuingLocation: string | null;
  contractNumber: string | null;
  contactEmail: string | null;
  contractValueText: string | null;
  currency: string | null;
  successfulSupplier: string | null;
  supplierAddress: string | null;
  awardDate: string | null;
  justification: string | null;
}

export interface ContractAwardListItem extends ContractAwardImportRecord {
  importKey: string;
  contractValue: number | null;
  sourceFileName: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ContractAwardRecord extends ContractAwardListItem {
  searchText: string;
}

export interface ContractAwardFilters {
  search?: string;
  cursor?: string | null;
  limit?: number;
}

export interface ContractAwardsSummary {
  total: number;
  organizations: number;
  suppliers: number;
  latestImportAt: number | null;
  latestImportFile: string | null;
}

export type ContractAwardAnalysisEntityKind = "supplier" | "organization";
export type ContractAwardAnalysisDatePreset = "all" | "1y" | "3y" | "custom";
export type ContractAwardFindingSeverity = "info" | "warning" | "critical";

export interface ContractAwardAnalysisFilters {
  datePreset?: ContractAwardAnalysisDatePreset;
  fromDate?: string | null;
  toDate?: string | null;
  opportunityType?: string | null;
  includePlaceholderSuppliers?: boolean;
  minimumAwardValue?: number | null;
}

export interface ContractAwardAppliedAnalysisFilters {
  datePreset: ContractAwardAnalysisDatePreset;
  fromDate: string | null;
  toDate: string | null;
  opportunityType: string | null;
  includePlaceholderSuppliers: boolean;
  minimumAwardValue: number | null;
}

export interface ContractAwardSummaryMetrics {
  totalAwards: number;
  totalAwardValue: number;
  uniqueSuppliers: number;
  uniqueIssuingOrganizations: number;
  averageAwardValue: number | null;
  medianAwardValue: number | null;
  contractNumberCoverage: number;
  justificationCoverage: number;
  placeholderSupplierShare: number;
}

export interface ContractAwardTrendPoint {
  label: string;
  periodStart: string;
  periodEnd: string;
  awardCount: number;
  totalValue: number;
}

export interface ContractAwardBreakdownRow {
  key: string;
  label: string;
  awardCount: number;
  totalValue: number;
  shareOfAwards: number;
  shareOfValue: number;
}

export interface ContractAwardRankingRow extends ContractAwardBreakdownRow {
  averageValue: number | null;
  secondaryLabel: string | null;
  placeholder: boolean;
}

export interface ContractAwardTypeMixRow {
  key: string;
  label: string;
  breakdown: ContractAwardBreakdownRow[];
}

export interface ContractAwardDataQualitySummary {
  totalRows: number;
  placeholderSupplierCount: number;
  placeholderSupplierRate: number;
  missingContractNumberCount: number;
  missingContractNumberRate: number;
  missingSupplierAddressCount: number;
  missingSupplierAddressRate: number;
  missingContactEmailCount: number;
  missingContactEmailRate: number;
  missingJustificationCount: number;
  missingJustificationRate: number;
  futureDatedAwardCount: number;
  futureDatedAwardRate: number;
}

export interface ContractAwardBenchmark {
  entityMedianAwardValue: number | null;
  peerMedianAwardValue: number | null;
  entityAverageAwardValue: number | null;
  peerAverageAwardValue: number | null;
  entityConcentration: number | null;
  peerMedianConcentration: number | null;
  entityAwardCount: number;
  peerMedianAwardCount: number | null;
}

export interface ContractAwardFinding {
  code: string;
  title: string;
  description: string;
  severity: ContractAwardFindingSeverity;
}

export interface ContractAwardEntityOption {
  kind: ContractAwardAnalysisEntityKind;
  key: string;
  label: string;
  awardCount: number;
  totalValue: number;
  placeholder: boolean;
}

export interface ContractAwardAnalysisOverview {
  appliedFilters: ContractAwardAppliedAnalysisFilters;
  typeOptions: string[];
  summary: ContractAwardSummaryMetrics;
  trends: ContractAwardTrendPoint[];
  supplierRankings: {
    byValue: ContractAwardRankingRow[];
    byAwardCount: ContractAwardRankingRow[];
    concentration: ContractAwardBreakdownRow[];
    diversityDistribution: ContractAwardBreakdownRow[];
  };
  organizationRankings: {
    byValue: ContractAwardRankingRow[];
    byAwardCount: ContractAwardRankingRow[];
    topSupplierConcentration: ContractAwardRankingRow[];
    opportunityTypeMix: ContractAwardTypeMixRow[];
  };
  dataQuality: ContractAwardDataQualitySummary;
  findings: ContractAwardFinding[];
}

export interface ContractAwardEntityProfile {
  entityKind: ContractAwardAnalysisEntityKind;
  counterpartyKind: ContractAwardAnalysisEntityKind;
  entityKey: string;
  label: string;
  appliedFilters: ContractAwardAppliedAnalysisFilters;
  typeOptions: string[];
  summary: ContractAwardSummaryMetrics & {
    uniqueCounterparties: number;
    uniqueOpportunityTypes: number;
    firstAwardDate: string | null;
    latestAwardDate: string | null;
    concentrationToTopCounterparty: number | null;
    topCounterpartyLabel: string | null;
  };
  trends: ContractAwardTrendPoint[];
  counterpartyRankings: ContractAwardRankingRow[];
  opportunityTypeMix: ContractAwardBreakdownRow[];
  awardSizeDistribution: ContractAwardBreakdownRow[];
  benchmark: ContractAwardBenchmark;
  findings: ContractAwardFinding[];
  dataQuality: ContractAwardDataQualitySummary;
  awards: ContractAwardListItem[];
}

export interface ScrapeRunCounts {
  listingCount: number;
  detailCount: number;
  opportunityCount: number;
  addendaCount: number;
  attachmentCount: number;
  pageCount: number;
  failedDetails: number;
}

export interface ScrapeRunProgress {
  phase: ScrapeRunPhase;
  message: string;
  percent: number;
  current: number;
  total: number | null;
  pagesCompleted: number;
  totalPages: number | null;
  listingsDiscovered: number;
  detailsCompleted: number;
  detailsTotal: number | null;
  batchesCompleted: number;
  batchesTotal: number | null;
  heartbeatAt: number;
}

export interface ScrapeRun {
  _id?: string;
  status: ScrapeRunStatus;
  trigger: ScrapeTrigger;
  startedAt: number;
  completedAt?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  artifactPath?: string | null;
  cancellationRequested: boolean;
  progress: ScrapeRunProgress;
  counts: ScrapeRunCounts;
}

export interface ListingPageParseResult {
  opportunities: OpportunityListing[];
  currentPage: number;
  totalPages: number;
}

export interface BrowserCheckPageState {
  isBrowserCheck: boolean;
  message: string | null;
  hasCaptcha: boolean;
}
