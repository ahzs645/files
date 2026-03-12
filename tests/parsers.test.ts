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

  it("prefers the visible browser-check error over unrelated header modal text", () => {
    const html = `
      <html>
        <head><title>Browser check: BC Bid</title></head>
        <body>
          <div class="header">
            <h1>Accessibility settings</h1>
          </div>
          <h1 class="maintitle">Browser check</h1>
          <div class="page-message-container visible">
            <span class="iv-message-details">Wrong captcha answer. Please try again.</span>
          </div>
          <input type="hidden" name="captcha_response" />
        </body>
      </html>
    `;

    const result = parseBrowserCheckPage(html);

    expect(result.isBrowserCheck).toBe(true);
    expect(result.hasCaptcha).toBe(true);
    expect(result.message).toBe("Wrong captcha answer. Please try again.");
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
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.name).toBe("RFP Package.pdf");
    expect(result.descriptionText).toContain("Modernize and migrate");
  });

  it("ignores non-addenda tables that only mention amendments", () => {
    const html = `
      <html>
        <body>
          <table>
            <thead>
              <tr><th>Amendments</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr><td>2</td><td>Open</td></tr>
              <tr><td>0</td><td>Closed</td></tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr><th>Addenda</th><th>Date</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><a href="/bare.aspx/en/fil/download_public/attachment-guid-1">Addendum 1</a></td>
                <td>Mar 10, 2026</td>
              </tr>
              <tr>
                <td><a href="/bare.aspx/en/fil/download_public/attachment-guid-1">Addendum 1</a></td>
                <td>Mar 10, 2026</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `;

    const result = parseDetailPage(
      html,
      "https://www.bcbid.gov.bc.ca",
      "https://www.bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/226320"
    );

    expect(result.addenda).toEqual([
      {
        title: "Addendum 1",
        date: "2026-03-10",
        link: "https://www.bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/attachment-guid-1"
      }
    ]);
    expect(result.attachments).toEqual([]);
  });

  it("strips scripts, selects, and noise from detail fields", async () => {
    const html = await readFixture("detail", "with-noise.html");
    const result = parseDetailPage(
      html,
      "https://www.bcbid.gov.bc.ca",
      "https://www.bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/226348"
    );

    expect(result.processId).toBe("226348");

    // Should extract clean field values without JS or dropdown noise
    const oppId = result.detailFields.find((f) => f.label === "Opportunity ID");
    expect(oppId?.value).toBe("BC-2026-0099");

    const status = result.detailFields.find((f) => f.label === "Status");
    expect(status?.value).toBe("Open");

    const issuedBy = result.detailFields.find((f) => f.label === "Issued by");
    expect(issuedBy?.value).toBe("City of Delta");

    const summary = result.detailFields.find((f) => f.label === "Summary Details");
    expect(summary?.value).toContain("Winskill Aquatic Centre");

    // Fields with only noise (time picker dropdowns, "Delete the value") should be excluded
    const opening = result.detailFields.find((f) => f.label === "Opening Date and Time");
    expect(opening).toBeUndefined();

    // Description should be clean — no __ivCtrl JS
    expect(result.descriptionText).toContain("Ceramic");
    expect(result.descriptionText).not.toContain("__ivCtrl");
    expect(result.descriptionText).not.toContain("GridView");

    // No field value should contain JS grid initialization code
    for (const field of result.detailFields) {
      expect(field.value).not.toContain("__ivCtrl");
      expect(field.value).not.toContain("GridView");
    }

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.name).toBe("Bid Package.pdf");
  });

  it("parses BC Bid field controls, amendment history, and document-row attachment names", () => {
    const html = `
      <html>
        <body>
          <div class="iv-content">
            <div class="readonly iv-html-type">
              To prepare a Submission for this opportunity as a registered supplier, please log in or register with BC Bid.
            </div>

            <div data-iv-role="field" class="field readonly iv-top-label iv-label-type iv-rawdatafield">
              <h3><span class="label-field">Opportunity Description</span></h3>
              <div data-iv-role="controlWrapper">
                <span data-iv-role="control" class="readonly">
                  Forest Service Road Emergence repairs and 'As and When' required FSR maintenance in the Rocky Mountain Forest District
                </span>
              </div>
            </div>

            <div data-iv-role="field" class="field readonly iv-top-label iv-string-type iv-selector iv-dropdown-selector">
              <label><span class="label-field">Status</span></label>
              <div data-iv-role="controlWrapper" class="control-wrapper">
                <div class="ui dropdown selection dropdown-selector selector-control search disable has-value downward">
                  <div class="text">Open</div>
                  <div class="iv-menu-container menu transition hidden">
                    <ul><li class="item">Closed</li></ul>
                  </div>
                </div>
              </div>
            </div>

            <div data-iv-role="field" class="field readonly iv-top-label iv-string-type iv-selector iv-dropdown-selector iv-autocompletion-selector">
              <label><span class="label-field">Regions</span></label>
              <div data-iv-role="controlWrapper" class="control-wrapper">
                <div class="ui dropdown selection dropdown-selector selector-control autocompletion search multiple disable has-value downward">
                  <ul class="values-container">
                    <li class="ui label transition visible iv-tag"><span class="selected_label">British Columbia</span></li>
                    <li class="ui label transition visible iv-tag"><span class="selected_label">East Kootenay</span></li>
                  </ul>
                </div>
              </div>
            </div>

            <table>
              <thead>
                <tr><th>Issued by</th></tr>
              </thead>
              <tbody>
                <tr><td>Ministry of Forests</td></tr>
              </tbody>
            </table>

            <table>
              <thead>
                <tr><th>Email address</th></tr>
              </thead>
              <tbody>
                <tr><td>forests.rockymountaindistrictoffice@gov.bc.ca</td></tr>
              </tbody>
            </table>

            <table>
              <thead>
                <tr><th>#</th><th>Amendment reason</th><th>Date &amp; time (Pacific Time)</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>1</td>
                  <td>Removal of MULRFQ27DRM001 - Forest Service Road Works in Rocky Mountain District.</td>
                  <td>2026-03-10 10:28:57 AM</td>
                </tr>
              </tbody>
            </table>

            <table>
              <thead>
                <tr><th>Addenda</th><th>Date</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><a href="/bare.aspx/en/fil/download_public/addendum-guid-1">Addendum 1</a></td>
                  <td>Mar 10, 2026</td>
                </tr>
              </tbody>
            </table>

            <table>
              <thead>
                <tr><th>Document name</th><th>Attachment</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Opportunity Information Package</td>
                  <td><a href="/bare.aspx/en/fil/download_public/doc-guid-1">MULRFQ27DRM001.pdf</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </body>
      </html>
    `;

    const result = parseDetailPage(
      html,
      "https://www.bcbid.gov.bc.ca",
      "https://www.bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/226290"
    );

    expect(result.processId).toBe("226290");
    expect(result.descriptionText).toBe(
      "Forest Service Road Emergence repairs and 'As and When' required FSR maintenance in the Rocky Mountain Forest District"
    );

    expect(result.detailFields).toEqual(
      expect.arrayContaining([
        {
          label: "Opportunity Description",
          value:
            "Forest Service Road Emergence repairs and 'As and When' required FSR maintenance in the Rocky Mountain Forest District"
        },
        { label: "Status", value: "Open" },
        { label: "Issued by", value: "Ministry of Forests" },
        { label: "Email address", value: "forests.rockymountaindistrictoffice@gov.bc.ca" }
      ])
    );

    expect(result.detailFields.find((field) => field.label === "Regions")?.value).toContain("British Columbia");
    expect(result.detailFields.find((field) => field.label === "Regions")?.value).toContain("East Kootenay");

    expect(result.addenda).toEqual([
      {
        title:
          "Amendment 1: Removal of MULRFQ27DRM001 - Forest Service Road Works in Rocky Mountain District.",
        date: "2026-03-10",
        link: null
      },
      {
        title: "Addendum 1",
        date: "2026-03-10",
        link: "https://www.bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/addendum-guid-1"
      }
    ]);

    expect(result.attachments).toEqual([
      {
        url: "https://www.bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/doc-guid-1",
        name: "Opportunity Information Package - MULRFQ27DRM001.pdf"
      }
    ]);
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
