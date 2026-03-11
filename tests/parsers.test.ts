import fs from "node:fs/promises";
import path from "node:path";

import { parseBrowserCheckPage, parseDetailPage, parseListingPage } from "@bcbid/shared";

const fixturesRoot = path.resolve(process.cwd(), "tests/fixtures");

async function readFixture(...segments: string[]) {
  return await fs.readFile(path.join(fixturesRoot, ...segments), "utf8");
}

describe("shared BC Bid parsers", () => {
  it("detects the browser check page", async () => {
    const html = await readFixture("browser-check", "browser-check.html");
    const result = parseBrowserCheckPage(html);

    expect(result.isBrowserCheck).toBe(true);
    expect(result.hasCaptcha).toBe(true);
    expect(result.message).toContain("checking your browser");
  });

  it("parses listing rows and pagination", async () => {
    const html = await readFixture("listing", "page1.html");
    const result = parseListingPage(html, "https://www.bcbid.gov.bc.ca");

    expect(result.currentPage).toBe(1);
    expect(result.totalPages).toBe(2);
    expect(result.opportunities).toHaveLength(2);
    expect(result.opportunities[0]?.processId).toBe("226320");
    expect(result.opportunities[0]?.commodities).toEqual(["Information Technology", "Cloud Services"]);
  });

  it("parses BC Bid button-based pagers and hidden max page index", () => {
    const html = `
      <html>
        <body>
          <input id="hdnCurrentPageIndexbody_x_grid_grd" value="1" />
          <input id="maxpageindexbody_x_grid_grd" value="9" />
          <table id="body_x_grid_grd">
            <tbody>
              <tr>
                <td>Open</td>
                <td>TEST-001</td>
                <td><a href="/page.aspx/en/bpm/process_manage_extranet/999">Example</a></td>
                <td>Software</td>
                <td>RFP</td>
                <td>2026-03-11</td>
                <td>2026-03-20</td>
                <td>9 days</td>
                <td>0</td>
                <td>2026-03-11</td>
                <td>Issuer</td>
                <td>Issued For</td>
                <td>No</td>
              </tr>
            </tbody>
          </table>
          <div class="iv pager left data table">
            <button aria-label="Page 1">1</button>
            <button aria-label="Page 2">2</button>
            <button aria-label="Page 3">3</button>
            <button aria-label="Page 4">4</button>
            <button aria-label="Page 5">5</button>
            <button aria-label="Page 6">6</button>
            <button aria-label="Page 7">7</button>
          </div>
        </body>
      </html>
    `;

    const result = parseListingPage(html, "https://www.bcbid.gov.bc.ca");

    expect(result.currentPage).toBe(2);
    expect(result.totalPages).toBe(10);
    expect(result.opportunities[0]?.processId).toBe("999");
  });

  it("parses detail fields, addenda, and attachments", async () => {
    const html = await readFixture("detail", "with-addenda.html");
    const result = parseDetailPage(
      html,
      "https://www.bcbid.gov.bc.ca",
      "https://www.bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/226320"
    );

    expect(result.processId).toBe("226320");
    expect(result.detailFields.some((field) => field.label === "Opportunity ID")).toBe(true);
    expect(result.addenda).toHaveLength(1);
    expect(result.attachments).toHaveLength(2);
    expect(result.descriptionText).toContain("Modernize and migrate");
  });

  it("handles missing optional sections", async () => {
    const html = await readFixture("detail", "without-optionals.html");
    const result = parseDetailPage(
      html,
      "https://www.bcbid.gov.bc.ca",
      "https://www.bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/226322"
    );

    expect(result.processId).toBe("226322");
    expect(result.addenda).toEqual([]);
    expect(result.attachments).toEqual([]);
  });
});
