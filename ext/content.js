// Content script — runs in BC Bid page context
// All pagination is AJAX-based, content script state is preserved throughout.

let isScraping = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TRIGGER_SCRAPE" && !isScraping) {
    isScraping = true;
    sendResponse({ ok: true });
    runScrape(msg.resumeFromPage || 0);
  } else if (msg.type === "TRIGGER_SCRAPE" && isScraping) {
    sendResponse({ ok: false, error: "Already scraping" });
  }
  return true;
});

async function runScrape(resumeFromPage) {
  try {
    const table = document.getElementById("body_x_grid_grd");
    if (!table) {
      chrome.runtime.sendMessage({
        type: "SCRAPE_ERROR",
        error: "Could not find the data table. Make sure you are on the contract browse page.",
      });
      isScraping = false;
      return;
    }

    // Get record count (click "More than X" if needed)
    let totalRecords = 0;
    const countEl = document.querySelector('[data-role="pager-count"]');
    if (countEl) {
      const text = countEl.innerText.trim();
      if (text.toLowerCase().includes("more than")) {
        countEl.click();
        totalRecords = await waitForRecordCount(countEl);
      } else {
        const match = text.match(/([\d,]+)\s*Record\(s\)/i);
        if (match) totalRecords = parseInt(match[1].replace(/,/g, ""), 10);
      }
    }

    // Extract headers
    const headerRow = table.querySelector("thead tr, tr:first-child");
    const headers = [];
    if (headerRow) {
      for (const th of headerRow.querySelectorAll("th, td")) {
        const text = th.innerText.trim();
        if (text) headers.push(text);
      }
    }
    if (headers.length === 0) {
      chrome.runtime.sendMessage({
        type: "SCRAPE_ERROR",
        error: "Could not find table headers.",
      });
      isScraping = false;
      return;
    }

    const estimatedPages = totalRecords > 0 ? Math.ceil(totalRecords / 15) : 0;

    // If resuming, navigate to the resume page; otherwise go to first page
    if (resumeFromPage > 0) {
      // Navigate to the target page by clicking FirstPage then NextPage repeatedly
      // Or use the grid's GoToPageOfGrid via the page buttons
      await navigateToPage(table, resumeFromPage);
    } else {
      const firstBtn = document.getElementById(
        "body_x_grid_gridPagerBtnFirstPage"
      );
      if (firstBtn && !firstBtn.classList.contains("disabled")) {
        firstBtn.click();
        await waitForAjaxUpdate(table);
      }
    }

    // Scrape pages by clicking NextPage until done
    let pagesScraped = resumeFromPage;

    while (true) {
      const rows = scrapeCurrentPage(table, headers.length);
      pagesScraped++;

      chrome.runtime.sendMessage({
        type: "SCRAPE_PROGRESS",
        headers: headers,
        rows,
        totalRecords,
        totalPages: estimatedPages,
        pagesScraped,
      });

      // Check for next page
      const nextBtn = document.getElementById(
        "body_x_grid_gridPagerBtnNextPage"
      );
      if (!nextBtn || nextBtn.classList.contains("disabled")) {
        break; // last page
      }

      // Throttle: small delay between pages to avoid server timeout
      await sleep(200);

      // Click next with retry
      const advanced = await clickNextWithRetry(table, nextBtn);
      if (!advanced) {
        // Save where we stopped so we can resume
        chrome.runtime.sendMessage({
          type: "SCRAPE_STOPPED",
          pagesScraped,
          error: "Server timeout — click Resume to continue.",
        });
        isScraping = false;
        return;
      }
    }

    chrome.runtime.sendMessage({ type: "SCRAPE_DONE", pagesScraped });
  } catch (err) {
    chrome.runtime.sendMessage({ type: "SCRAPE_ERROR", error: err.message });
  }
  isScraping = false;
}

// Click next page with up to 3 retries and increasing delay
async function clickNextWithRetry(table, nextBtn) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      nextBtn.click();
      const updated = await waitForAjaxUpdate(table, 10000);
      if (updated) return true;
    } catch (e) {
      // ignore, will retry
    }
    // Wait before retry: 2s, 5s, 10s
    const delay = attempt === 1 ? 2000 : attempt === 2 ? 5000 : 10000;
    await sleep(delay);

    // Re-find the button in case DOM changed
    const freshBtn = document.getElementById(
      "body_x_grid_gridPagerBtnNextPage"
    );
    if (!freshBtn || freshBtn.classList.contains("disabled")) return false;
  }
  return false;
}

// Navigate to a specific page index for resume
async function navigateToPage(table, targetPage) {
  // Go to first page
  const firstBtn = document.getElementById(
    "body_x_grid_gridPagerBtnFirstPage"
  );
  if (firstBtn && !firstBtn.classList.contains("disabled")) {
    firstBtn.click();
    await waitForAjaxUpdate(table);
  }

  // Click next until we reach the target page
  for (let i = 0; i < targetPage; i++) {
    await sleep(200);
    const nextBtn = document.getElementById(
      "body_x_grid_gridPagerBtnNextPage"
    );
    if (!nextBtn || nextBtn.classList.contains("disabled")) break;
    nextBtn.click();
    await waitForAjaxUpdate(table);
  }
}

function scrapeCurrentPage(table, colCount) {
  const rows = [];
  const dataRows = table.querySelectorAll("tbody tr, tr:not(:first-child)");
  for (const tr of dataRows) {
    if (tr.querySelector("th")) continue;
    if (tr.querySelector('[id*="Pager"]')) continue;
    if (tr.id && tr.id.toLowerCase().includes("pager")) continue;

    const cells = tr.querySelectorAll("td");
    if (cells.length === 0) continue;

    const row = [];
    for (let i = 0; i < cells.length && i < colCount; i++) {
      row.push(cells[i].innerText.trim());
    }
    if (row.every((c) => c === "")) continue;
    rows.push(row);
  }
  return rows;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForRecordCount(el) {
  return new Promise((resolve) => {
    let checks = 0;
    const interval = setInterval(() => {
      checks++;
      const text = el.innerText.trim();
      if (!text.toLowerCase().includes("more than")) {
        clearInterval(interval);
        const match = text.match(/([\d,]+)\s*Record\(s\)/i);
        resolve(match ? parseInt(match[1].replace(/,/g, ""), 10) : 0);
        return;
      }
      if (checks >= 60) {
        clearInterval(interval);
        resolve(0);
      }
    }, 500);
  });
}

// Wait for AJAX table update — returns true if DOM changed, false on timeout
function waitForAjaxUpdate(table, timeout) {
  timeout = timeout || 8000;
  return new Promise((resolve) => {
    const target = table.querySelector("tbody") || table;
    let resolved = false;
    const done = (success) => {
      if (!resolved) {
        resolved = true;
        resolve(success);
      }
    };
    const observer = new MutationObserver(() => {
      observer.disconnect();
      setTimeout(() => done(true), 300);
    });
    observer.observe(target, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      done(false);
    }, timeout);
  });
}
