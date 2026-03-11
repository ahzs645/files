import { createPlaywrightRouter, Dataset, log } from 'crawlee';
import { parseSearchResults, parseDetailPage } from './parsers.js';

export const router = createPlaywrightRouter();

// ─── SEARCH PAGE ─────────────────────────────────────────────────────────────
// Loads the search form, optionally applies filters, clicks Search,
// then scrapes the results grid and enqueues all pages + detail links.

router.addHandler('SEARCH', async ({ page, request, enqueueLinks }) => {
    log.info('Loading BC Bid search page...');

    // Wait for the search form to be ready
    await page.waitForSelector('#mainForm', { timeout: 30000 });

    // Apply filters if provided
    const { filters = {} } = request.userData;

    if (filters.status) {
        await page.selectOption('select[name="body:x:selSrfxCode"]', filters.status);
    }
    if (filters.keyword) {
        await page.fill('input[name="body:x:txtQuery"]', filters.keyword);
    }
    if (filters.opportunityType) {
        await page.selectOption('select[name="body:x:selRtgrouCode"]', filters.opportunityType);
    }
    if (filters.region) {
        await page.selectOption('select[name="body:x:selRfpIdAreaLevelAreaNode"]', filters.region);
    }
    if (filters.organization) {
        await page.selectOption('select[name="body:x:selBpmIdOrgaLevelOrgaNode"]', filters.organization);
    }
    if (filters.industryCategory) {
        await page.selectOption('select[name="body:x:selPtypeCode"]', filters.industryCategory);
    }

    // Click the search button
    const searchBtn = page.locator('input[type="submit"][value="Search"], button:has-text("Search")');
    await searchBtn.first().click();

    // Wait for results grid to load
    await page.waitForSelector('#body_x_grid_grd', { timeout: 30000 });

    // Scrape the first page of results
    const html = await page.content();
    const opportunities = parseSearchResults(html);
    log.info(`Page 1: Found ${opportunities.length} opportunities`);

    // Save to dataset
    for (const opp of opportunities) {
        await Dataset.pushData(opp);
    }

    // Enqueue detail pages for each opportunity
    for (const opp of opportunities) {
        if (opp.detailUrl) {
            await enqueueLinks({
                urls: [`https://www.bcbid.gov.bc.ca${opp.detailUrl}`],
                label: 'DETAIL',
                userData: { opportunityId: opp.opportunityId },
            });
        }
    }

    // Handle pagination — find all page links and click through them
    await handlePagination(page, enqueueLinks);
});

// ─── PAGINATION ──────────────────────────────────────────────────────────────
// Clicks through each page of results, scrapes, and enqueues detail links.

async function handlePagination(page, enqueueLinks) {
    // Check for pagination controls
    const pageLinks = await page.locator('.iv-grid-pager a[href*="GoToPageOfGrid"]').all();
    const totalPages = pageLinks.length + 1; // +1 for current page

    log.info(`Found ${totalPages} pages of results`);

    for (let pageIndex = 1; pageIndex < totalPages; pageIndex++) {
        log.info(`Navigating to page ${pageIndex + 1}...`);

        try {
            // Click the page number — Ivalua uses JS function calls
            await page.evaluate((idx) => {
                if (window.__ivCtrl && window.__ivCtrl['body_x_grid_grd']) {
                    window.__ivCtrl['body_x_grid_grd'].GoToPageOfGrid(0, idx);
                }
            }, pageIndex);

            // Wait for the grid to update (AJAX partial reload)
            await page.waitForTimeout(2000);
            await page.waitForSelector('#body_x_grid_grd', { timeout: 15000 });

            // Scrape this page
            const html = await page.content();
            const opportunities = parseSearchResults(html);
            log.info(`Page ${pageIndex + 1}: Found ${opportunities.length} opportunities`);

            for (const opp of opportunities) {
                await Dataset.pushData(opp);
            }

            // Enqueue detail pages
            for (const opp of opportunities) {
                if (opp.detailUrl) {
                    await enqueueLinks({
                        urls: [`https://www.bcbid.gov.bc.ca${opp.detailUrl}`],
                        label: 'DETAIL',
                        userData: { opportunityId: opp.opportunityId },
                    });
                }
            }
        } catch (err) {
            log.warning(`Failed to load page ${pageIndex + 1}: ${err.message}`);
        }
    }
}

// ─── DETAIL PAGE ─────────────────────────────────────────────────────────────
// Scrapes the full opportunity detail page (Overview, Details, Addenda tabs).

router.addHandler('DETAIL', async ({ page, request }) => {
    const { opportunityId } = request.userData;
    log.info(`Scraping detail page for ${opportunityId}...`);

    await page.waitForSelector('.iv-content, .iv-form', { timeout: 30000 });

    // Click through tabs to load all content
    const tabs = ['Overview', 'Opportunity Details', 'Addenda'];
    const tabData = {};

    for (const tabName of tabs) {
        try {
            const tab = page.locator(`a:has-text("${tabName}"), [role="tab"]:has-text("${tabName}")`);
            if (await tab.count() > 0) {
                await tab.first().click();
                await page.waitForTimeout(1500);
            }
        } catch {
            // Tab might not exist for this opportunity
        }
    }

    const html = await page.content();
    const detail = parseDetailPage(html, opportunityId);

    // Update the existing dataset entry with detail info
    if (detail) {
        await Dataset.pushData({
            ...detail,
            _type: 'detail',
            opportunityId,
            scrapedAt: new Date().toISOString(),
        });
    }
});
