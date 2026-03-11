import { PlaywrightCrawler, Dataset, log } from 'crawlee';
import { router } from './routes.js';

// Configure logging
log.setLevel(log.LEVELS.INFO);

const crawler = new PlaywrightCrawler({
    requestHandler: router,

    // Be respectful to a government site
    maxConcurrency: 2,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 120,

    // Playwright launch options
    launchContext: {
        launchOptions: {
            headless: true,
        },
    },

    // Slow down requests to avoid overwhelming BC Bid
    navigationTimeoutSecs: 60,

    // Pre-navigation hooks — set realistic viewport & headers
    preNavigationHooks: [
        async ({ page }) => {
            await page.setViewportSize({ width: 1280, height: 800 });
        },
    ],
});

// Start the crawl from the search page
await crawler.run([
    {
        url: 'https://www.bcbid.gov.bc.ca/page.aspx/en/rfp/request_browse_public',
        label: 'SEARCH',
        userData: {
            filters: {
                // Set to 'val' for Open opportunities, or leave empty for all
                status: '',
            },
        },
    },
]);

// Export results
const dataset = await Dataset.open();
const { items } = await dataset.getData();

log.info(`Scrape complete. Total opportunities: ${items.length}`);

// Write a combined JSON output
await dataset.exportToJSON('bc-bid-opportunities');
await dataset.exportToCSV('bc-bid-opportunities');

log.info('Results exported to storage/key_value_stores/default/');
