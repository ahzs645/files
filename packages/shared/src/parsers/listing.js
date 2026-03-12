import * as cheerio from "cheerio";
import { dedupeStrings, extractProcessId, normalizeWhitespace, parseDateToIso, toAbsoluteUrl } from "./utils";
function parsePagerValue($) {
    const hiddenValue = Number.parseInt(normalizeWhitespace($("input[name='hdnCurrentPageIndexbody_x_grid_grd'], #hdnCurrentPageIndexbody_x_grid_grd")
        .first()
        .attr("value")), 10);
    const currentPage = Number.isFinite(hiddenValue) ? hiddenValue + 1 : 1;
    const hiddenMaxPageIndex = Number.parseInt(normalizeWhitespace($("input[name='maxpageindexbody_x_grid_grd'], #maxpageindexbody_x_grid_grd")
        .first()
        .attr("value")), 10);
    const pageNumbers = $(".iv-grid-pager a, .iv-grid-pager span, .iv-grid-pager button, .iv.pager a, .iv.pager span, .iv.pager button")
        .map((_, element) => {
        const ariaLabel = normalizeWhitespace($(element).attr("aria-label"));
        const labelMatch = ariaLabel.match(/page\s+(\d+)/i);
        if (labelMatch?.[1]) {
            return Number.parseInt(labelMatch[1], 10);
        }
        return Number.parseInt(normalizeWhitespace($(element).text()), 10);
    })
        .get()
        .filter((value) => Number.isFinite(value));
    const totalPages = Number.isFinite(hiddenMaxPageIndex)
        ? Math.max(currentPage, hiddenMaxPageIndex + 1, ...pageNumbers, 1)
        : Math.max(currentPage, ...pageNumbers, 1);
    return { currentPage, totalPages };
}
export function parseListingPage(html, baseUrl) {
    const $ = cheerio.load(html);
    const opportunities = [];
    $("#body_x_grid_grd tbody tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 13) {
            return;
        }
        const getText = (index) => normalizeWhitespace($(cells[index]).text());
        const detailHref = $(cells[2]).find("a[href]").attr("href") ??
            $(cells[1]).find("a[href]").attr("href") ??
            null;
        const detailUrl = toAbsoluteUrl(baseUrl, detailHref);
        const processId = extractProcessId(detailUrl);
        const opportunityId = getText(1);
        if (!opportunityId) {
            return;
        }
        opportunities.push({
            sourceKey: processId ?? opportunityId,
            processId,
            opportunityId,
            status: getText(0),
            description: getText(2),
            listingUrl: null,
            detailUrl,
            commodities: dedupeStrings(getText(3).split(/[,;]+/)),
            type: getText(4),
            issueDate: parseDateToIso(getText(5)),
            closingDate: parseDateToIso(getText(6)),
            endsIn: getText(7) || null,
            amendments: Number.parseInt(getText(8), 10) || 0,
            lastUpdated: parseDateToIso(getText(9)),
            issuedBy: getText(10) || null,
            issuedFor: getText(11) || null,
            interestedVendorList: /yes/i.test(getText(12)),
            sourceCapturedAt: new Date().toISOString()
        });
    });
    const { currentPage, totalPages } = parsePagerValue($);
    return { opportunities, currentPage, totalPages };
}
