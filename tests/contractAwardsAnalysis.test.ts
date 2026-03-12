import {
  buildContractAwardAnalysisOverview,
  buildContractAwardEntityOptions,
  buildContractAwardEntityProfile,
} from "../convex/contractAwardsAnalysisHelpers";

type AwardRecord = Parameters<typeof buildContractAwardAnalysisOverview>[0][number];

function createAward(overrides: Partial<AwardRecord>): AwardRecord {
  return {
    _id: "award_1" as AwardRecord["_id"],
    _creationTime: 0,
    importKey: "award-1",
    opportunityId: "OPP-1",
    opportunityDescription: "Default opportunity",
    opportunityType: "Request for Proposal",
    issuingOrganization: "Ministry of Testing",
    issuingLocation: "Victoria",
    contractNumber: "CN-1",
    contactEmail: "contracts@example.com",
    contractValueText: "100000",
    contractValue: 100000,
    currency: "CAD",
    successfulSupplier: "Alpha Consulting",
    supplierAddress: "123 Example St",
    awardDate: "2025-01-15",
    justification: null,
    searchText: "default",
    sourceFileName: "awards.json",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("contractAwardsAnalysisHelpers", () => {
  const awards: AwardRecord[] = [
    createAward({
      _id: "award_a1" as AwardRecord["_id"],
      importKey: "award-a1",
      successfulSupplier: "Alpha Consulting",
      issuingOrganization: "Ministry of Testing",
      contractValueText: "100000",
      contractValue: 100000,
      contractNumber: null,
      justification: null,
      awardDate: "2025-01-15",
    }),
    createAward({
      _id: "award_a2" as AwardRecord["_id"],
      importKey: "award-a2",
      successfulSupplier: "Alpha Consulting",
      issuingOrganization: "Ministry of Testing",
      contractValueText: "200000",
      contractValue: 200000,
      contractNumber: null,
      justification: "Urgent continuation",
      awardDate: "2025-06-20",
    }),
    createAward({
      _id: "award_b1" as AwardRecord["_id"],
      importKey: "award-b1",
      successfulSupplier: "Beta Systems",
      issuingOrganization: "City of Sample",
      contractValueText: "50000",
      contractValue: 50000,
      contractNumber: "CN-B1",
      awardDate: "2099-01-01",
      justification: null,
    }),
    createAward({
      _id: "award_m1" as AwardRecord["_id"],
      importKey: "award-m1",
      successfulSupplier: "Migrated Supplier",
      issuingOrganization: "City of Sample",
      contractValueText: "75000",
      contractValue: 75000,
      contractNumber: "CN-M1",
      awardDate: "2024-09-01",
    }),
  ];

  it("builds overview metrics while hiding placeholder suppliers by default", () => {
    const overview = buildContractAwardAnalysisOverview(awards, {});

    expect(overview.summary.totalAwards).toBe(3);
    expect(overview.summary.uniqueSuppliers).toBe(2);
    expect(overview.dataQuality.futureDatedAwardCount).toBe(1);
    expect(overview.supplierRankings.byValue[0].label).toBe("Alpha Consulting");
    expect(
      overview.supplierRankings.byValue.some((row) => row.label === "Migrated Supplier"),
    ).toBe(false);
  });

  it("includes placeholder suppliers in entity options only when requested", () => {
    const hidden = buildContractAwardEntityOptions(awards, "supplier", undefined, false);
    const shown = buildContractAwardEntityOptions(awards, "supplier", undefined, true);

    expect(hidden.some((row) => row.label === "Migrated Supplier")).toBe(false);
    expect(shown.some((row) => row.label === "Migrated Supplier")).toBe(true);
  });

  it("builds supplier profiles with concentration and low-diversity flags", () => {
    const profile = buildContractAwardEntityProfile(
      awards,
      "supplier",
      "alpha-consulting",
      {},
    );

    expect(profile).not.toBeNull();
    expect(profile?.summary.totalAwards).toBe(2);
    expect(profile?.summary.uniqueCounterparties).toBe(1);
    expect(profile?.summary.concentrationToTopCounterparty).toBe(1);
    expect(profile?.findings.some((finding) => finding.code === "high-issuer-dependence")).toBe(
      true,
    );
    expect(profile?.findings.some((finding) => finding.code === "supplier-low-diversity")).toBe(
      true,
    );
  });

  it("builds organization profiles with placeholder and future-date flags when enabled", () => {
    const profile = buildContractAwardEntityProfile(
      awards,
      "organization",
      "city-of-sample",
      { includePlaceholderSuppliers: true },
    );

    expect(profile).not.toBeNull();
    expect(profile?.summary.totalAwards).toBe(2);
    expect(profile?.dataQuality.placeholderSupplierCount).toBe(1);
    expect(profile?.dataQuality.futureDatedAwardCount).toBe(1);
    expect(profile?.findings.some((finding) => finding.code === "org-placeholder-suppliers")).toBe(
      true,
    );
    expect(profile?.findings.some((finding) => finding.code === "org-future-awards")).toBe(
      true,
    );
  });
});
