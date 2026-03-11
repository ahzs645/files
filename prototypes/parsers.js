import * as cheerio from 'cheerio';

/**
 * Parse the search results grid (#body_x_grid_grd) from BC Bid HTML.
 *
 * The grid has 13 columns:
 *   Status | Opportunity ID | Description | Commodities | Type |
 *   Issue Date | Closing Date | Ends In | # Amendments | Last Updated |
 *   Organization (Issued by) | Organization (Issued for) |
 *   Interested Vendor List Available
 */
export function parseSearchResults(html) {
    const $ = cheerio.load(html);
    const opportunities = [];

    // Each row in the results grid
    $('#body_x_grid_grd tbody tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 10) return; // Skip header/empty rows

        const getText = (idx) => $(cells[idx]).text().trim();
        const getLink = (idx) => $(cells[idx]).find('a').attr('href') || null;

        const opportunity = {
            _type: 'listing',
            status: getText(0),
            opportunityId: getText(1),
            description: getText(2),
            detailUrl: getLink(2) || getLink(1),
            commodities: getText(3)
                .split(/[,;]/)
                .map((s) => s.trim())
                .filter(Boolean),
            type: getText(4),
            issueDate: parseDate(getText(5)),
            closingDate: parseDate(getText(6)),
            endsIn: getText(7),
            amendments: parseInt(getText(8), 10) || 0,
            lastUpdated: parseDate(getText(9)),
            issuedBy: getText(10),
            issuedFor: getText(11),
            interestedVendorList: getText(12)?.toLowerCase() === 'yes',
            scrapedAt: new Date().toISOString(),
        };

        // Only push if we got a real row with an ID
        if (opportunity.opportunityId) {
            opportunities.push(opportunity);
        }
    });

    return opportunities;
}

/**
 * Parse an opportunity detail page.
 * Extracts overview fields, description, addenda, and attachment links.
 */
export function parseDetailPage(html, opportunityId) {
    const $ = cheerio.load(html);

    // Extract key-value pairs from the form/detail layout
    const fields = {};
    $('.iv-form-row, .iv-field-row, tr').each((_, el) => {
        const label = $(el).find('.iv-field-label, th, label').first().text().trim();
        const value = $(el).find('.iv-field-value, td, .iv-field-text').first().text().trim();
        if (label && value) {
            fields[normalizeFieldName(label)] = value;
        }
    });

    // Extract addenda/amendments
    const addenda = [];
    $('table')
        .filter((_, el) => $(el).text().includes('Addend'))
        .find('tbody tr')
        .each((_, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 2) {
                addenda.push({
                    title: $(cells[0]).text().trim(),
                    date: $(cells[1]).text().trim(),
                    link: $(cells[0]).find('a').attr('href') || null,
                });
            }
        });

    // Extract file attachments (download links)
    const attachments = [];
    $('a[href*="download_public"]').each((_, el) => {
        attachments.push({
            name: $(el).text().trim(),
            url: $(el).attr('href'),
        });
    });

    // Extract full description text
    const description =
        $('[class*="description"], [id*="description"]').text().trim() ||
        fields.description ||
        '';

    return {
        opportunityId,
        fields,
        description,
        addenda,
        attachments,
        detailUrl: `https://www.bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/${opportunityId}`,
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse BC Bid date strings (e.g., "Mar 01, 2026" or "2026-03-01") into ISO format.
 */
function parseDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : d.toISOString().split('T')[0];
}

/**
 * Normalize a label like "Closing Date:" → "closingDate"
 */
function normalizeFieldName(label) {
    return label
        .replace(/[:\*]/g, '')
        .trim()
        .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
        .replace(/^(.)/, (c) => c.toLowerCase());
}
