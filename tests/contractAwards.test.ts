import {
  buildContractAwardImportKey,
  parseContractAwardsJson,
  parseContractAwardValue,
} from "@bcbid/shared";

describe("contract award import helpers", () => {
  it("parses array exports from the browser scraper", () => {
    const records = parseContractAwardsJson(
      JSON.stringify([
        {
          "Opportunity ID": "MCFDSF-EY-2021",
          "Opportunity Description": "Multi-Cultural Early Years Services",
          "Opportunity Type": "Short-form Request for Proposal",
          "Issuing Organization": "Ministry of Children and Family Development",
          "Issuing Location": "#101 – 10221 153 Street Surrey",
          "Contract Number": "",
          "Contact Email": "MCFFraserContracts@gov.bc.ca",
          "Contract Value": "366,094.96",
          Currency: "CAD",
          "Successful Supplier": "Options Community Services Society",
          "Supplier Address": "9815 - 140th Street Surrey British Columbia Canada",
          "Award Date": "2021-05-10",
          Justification: "",
        },
      ]),
    );

    expect(records).toEqual([
      {
        opportunityId: "MCFDSF-EY-2021",
        opportunityDescription: "Multi-Cultural Early Years Services",
        opportunityType: "Short-form Request for Proposal",
        issuingOrganization: "Ministry of Children and Family Development",
        issuingLocation: "#101 – 10221 153 Street Surrey",
        contractNumber: null,
        contactEmail: "MCFFraserContracts@gov.bc.ca",
        contractValueText: "366,094.96",
        currency: "CAD",
        successfulSupplier: "Options Community Services Society",
        supplierAddress: "9815 - 140th Street Surrey British Columbia Canada",
        awardDate: "2021-05-10",
        justification: null,
      },
    ]);
  });

  it("parses header-row payloads", () => {
    const records = parseContractAwardsJson(
      JSON.stringify({
        headers: [
          "Opportunity ID",
          "Opportunity Description",
          "Successful Supplier",
          "Award Date",
        ],
        rows: [["AB-123", "Airport snow removal", "Northwind", "2026-01-02"]],
      }),
    );

    expect(records).toEqual([
      expect.objectContaining({
        opportunityId: "AB-123",
        opportunityDescription: "Airport snow removal",
        successfulSupplier: "Northwind",
        awardDate: "2026-01-02",
      }),
    ]);
  });

  it("normalizes value parsing and import keys", () => {
    const record = parseContractAwardsJson(
      JSON.stringify([
        {
          "Opportunity ID": "AB-123",
          "Opportunity Description": "Airport snow removal",
          "Successful Supplier": "Northwind",
          "Contract Value": "$1,250.50",
          "Award Date": "2026-01-02",
        },
      ]),
    )[0];

    expect(parseContractAwardValue(record.contractValueText)).toBe(1250.5);
    expect(buildContractAwardImportKey(record)).toContain("ab-123");
    expect(buildContractAwardImportKey(record)).toContain("northwind");
  });

  it("rejects unsupported payloads", () => {
    expect(() => parseContractAwardsJson(JSON.stringify({ foo: "bar" }))).toThrow(
      "Unsupported contract award JSON format.",
    );
  });
});
