import fs from "node:fs/promises";
import { parseListingPage } from "../packages/shared/src/parsers/listing";

const baseUrl = "https://bcbid.gov.bc.ca";
const grid = (rows: string) => `<table id="body_x_grid_grd"><tbody>${rows}</tbody></table>`;

describe("current public BC Bid listing grid", () => {
  it("reads live ID-column links, separate commodity bullets, and vendor availability", async () => {
    const html = await fs.readFile("tests/fixtures/listing/public-grid-2026-09.html", "utf8");
    const { opportunities } = parseListingPage(html, baseUrl);

    expect(opportunities).toHaveLength(6);
    expect(opportunities[0]).toMatchObject({
      processId: "233860",
      opportunityId: "RFP 2026-VCH-005",
      description: "Food Delivery Services from SPH to VGH",
      detailUrl: `${baseUrl}/page.aspx/en/bpm/process_manage_extranet/233860`,
      issuedBy: "Vancouver Coastal Health Authority",
      interestedVendorList: false
    });
    expect(opportunities[3]?.commodities).toEqual([
      "Charging network", "Electric vehicle charging systems", "Electro mobility service"
    ]);
    expect(opportunities[5]?.interestedVendorList).toBe(true);
  });

  it.each(["", '<tr><td colspan="13">No results found.</td></tr>', '<tr><td colspan="13">No records available</td></tr>'])(
    "keeps genuine empty results valid: %s", rows => {
      expect(parseListingPage(grid(rows), baseUrl).opportunities).toEqual([]);
    }
  );

  it.each([
    '<tr><td colspan="13">Loading...</td></tr>',
    '<tr><td>Open</td><td><a href="/page.aspx/en/bpm/process_manage_extranet/233860">RFP 2026-VCH-005</a></td></tr>'
  ])("does not report success for an unreadable nonempty grid: %s", rows => {
    expect(() => parseListingPage(grid(rows), baseUrl)).toThrow("could not be read");
  });

  it("does not silently discard a malformed row after valid records", async () => {
    const html = await fs.readFile("tests/fixtures/listing/public-grid-2026-09.html", "utf8");
    const malformed = html.replace("</tbody>", '<tr><td>Open</td><td>Truncated record</td></tr></tbody>');
    expect(() => parseListingPage(malformed, baseUrl)).toThrow("could not be read");
  });

  it("rejects a full-width row with a missing opportunity ID", () => {
    const row = `<tr><td>Open</td><td></td>${"<td>value</td>".repeat(11)}</tr>`;
    expect(() => parseListingPage(grid(row), baseUrl)).toThrow("without an opportunity ID");
  });

  it.each([
    '<input id="maxpageindexbody_x_grid_grd" value="6" />',
    '<div class="iv pager"><button aria-label="Page 1">1</button><button aria-label="Page 7">7</button></div>'
  ])("rejects an empty capture when pagination reports more results: %s", pager => {
    expect(() => parseListingPage(grid("") + pager, baseUrl)).toThrow("more result pages but no readable records");
  });
});
