// Content script — runs in BC Bid page context
// All pagination is AJAX-based, content script state is preserved throughout.

let isScraping = false;
let cancelRequested = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TRIGGER_SCRAPE" && !isScraping) {
    isScraping = true;
    cancelRequested = false;
    sendResponse({ ok: true });
    runScrape(msg.resumeFromPage || 0);
  } else if (msg.type === "TRIGGER_SCRAPE" && isScraping) {
    sendResponse({ ok: false, error: "Already scraping" });
  } else if (msg.type === "CANCEL_SCRAPE") {
    cancelRequested = true;
    sendResponse({ ok: true });
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

    // Read record count without clicking — just parse whatever is showing
    let totalRecords = 0;
    const countEl = document.querySelector('[data-role="pager-count"]');
    if (countEl) {
      const text = countEl.innerText.trim();
      const match = text.match(/([\d,]+)\s*Record\(s\)/i);
      if (match) totalRecords = parseInt(match[1].replace(/,/g, ""), 10);
    }

    // Extract headers using the label spans inside <th> for reliable text
    const headers = [];
    const thElements = table.querySelectorAll("thead th");
    for (const th of thElements) {
      const labelSpan = th.querySelector('[data-iv-role="label"]');
      const text = labelSpan
        ? labelSpan.innerText.trim()
        : th.innerText.trim();
      if (text) headers.push(text);
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
      await navigateToPage(resumeFromPage);
    } else {
      // Only click FirstPage if we're not already on page 0
      const curPage = getCurrentPageIndex();
      if (curPage !== "0" && curPage !== "-1") {
        const firstBtn = document.getElementById(
          "body_x_grid_gridPagerBtnFirstPage"
        );
        if (firstBtn && !firstBtn.classList.contains("disabled")) {
          firstBtn.click();
          await waitForAjaxUpdate(null);
        }
      }
    }

    // Scrape pages by clicking NextPage until done
    let pagesScraped = resumeFromPage;

    while (true) {
      // Re-query table each iteration (AJAX may replace the element)
      const currentTable = document.getElementById("body_x_grid_grd");
      if (!currentTable) break;

      const rows = scrapeCurrentPage(currentTable, headers.length);
      pagesScraped++;

      chrome.runtime.sendMessage({
        type: "SCRAPE_PROGRESS",
        headers: headers,
        rows,
        totalRecords,
        totalPages: estimatedPages,
        pagesScraped,
      });

      // Check if cancelled
      if (cancelRequested) {
        chrome.runtime.sendMessage({
          type: "SCRAPE_STOPPED",
          pagesScraped,
          error: "Cancelled by user — click Resume to continue.",
        });
        isScraping = false;
        return;
      }

      // Check for next page (re-query since DOM may have been replaced)
      const nextBtn = document.getElementById(
        "body_x_grid_gridPagerBtnNextPage"
      );
      if (!nextBtn || nextBtn.classList.contains("disabled")) {
        break; // last page
      }

      // Throttle: small delay between pages to avoid server timeout
      await sleep(200);

      // Click next with retry
      const advanced = await clickNextWithRetry(nextBtn);
      if (!advanced) {
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
async function clickNextWithRetry(nextBtn) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Re-query button on retries (DOM may have been replaced)
      const btn =
        attempt === 1
          ? nextBtn
          : document.getElementById("body_x_grid_gridPagerBtnNextPage");
      if (!btn || btn.classList.contains("disabled")) return false;

      btn.click();
      const updated = await waitForAjaxUpdate(null, 10000);
      if (updated) return true;
    } catch (e) {
      // ignore, will retry
    }
    // Wait before retry: 2s, 5s, 10s
    const delay = attempt === 1 ? 2000 : attempt === 2 ? 5000 : 10000;
    await sleep(delay);
  }
  return false;
}

// Navigate to a specific page index for resume
async function navigateToPage(targetPage) {
  const firstBtn = document.getElementById(
    "body_x_grid_gridPagerBtnFirstPage"
  );
  if (firstBtn && !firstBtn.classList.contains("disabled")) {
    firstBtn.click();
    await waitForAjaxUpdate(null);
  }

  for (let i = 0; i < targetPage; i++) {
    await sleep(200);
    const nextBtn = document.getElementById(
      "body_x_grid_gridPagerBtnNextPage"
    );
    if (!nextBtn || nextBtn.classList.contains("disabled")) break;
    nextBtn.click();
    await waitForAjaxUpdate(null);
  }
}

function scrapeCurrentPage(table, colCount) {
  const rows = [];
  // Use data-object-type to identify data rows (e.g. "contract")
  let dataRows = table.querySelectorAll("tbody tr[data-object-type]");
  // Fallback: if no data-object-type rows, use all tbody tr
  if (dataRows.length === 0) {
    dataRows = table.querySelectorAll("tbody tr");
  }
  for (const tr of dataRows) {
    if (tr.querySelector("th")) continue;

    // Prefer cells marked with data-iv-role="cell"
    let cells = tr.querySelectorAll('td[data-iv-role="cell"]');
    // Fallback to all td
    if (cells.length === 0) {
      cells = tr.querySelectorAll("td");
    }
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

// The count button gets REPLACED (button -> span) after AJAX.
// Must re-query the DOM each poll, not reference the old element.
function waitForRecordCount() {
  return new Promise((resolve) => {
    let checks = 0;
    const interval = setInterval(() => {
      checks++;
      // Re-query DOM each time — the element gets replaced
      const el = document.querySelector('[data-role="pager-count"]');
      if (!el) {
        if (checks >= 40) { clearInterval(interval); resolve(0); }
        return;
      }
      const text = el.innerText.trim();
      if (!text.toLowerCase().includes("more than")) {
        clearInterval(interval);
        const match = text.match(/([\d,]+)\s*Record\(s\)/i);
        resolve(match ? parseInt(match[1].replace(/,/g, ""), 10) : 0);
        return;
      }
      if (checks >= 40) {
        clearInterval(interval);
        resolve(0);
      }
    }, 500);
  });
}

// Wait for AJAX page update by polling the hidden page index field.
// The table element may get replaced entirely during AJAX, so
// MutationObserver on the old element is unreliable.
function waitForAjaxUpdate(table, timeout) {
  timeout = timeout || 10000;
  const before = getCurrentPageIndex();
  const beforeFirstRow = getFirstRowText();
  return new Promise((resolve) => {
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 150;
      const nowPage = getCurrentPageIndex();
      const nowRow = getFirstRowText();
      // Detect change: page index changed OR first row content changed
      if (nowPage !== before || (beforeFirstRow && nowRow !== beforeFirstRow)) {
        clearInterval(interval);
        setTimeout(() => resolve(true), 200); // small buffer for DOM to settle
        return;
      }
      if (elapsed >= timeout) {
        clearInterval(interval);
        resolve(false);
      }
    }, 150);
  });
}

function getCurrentPageIndex() {
  const el = document.querySelector('[name="hdnCurrentPageIndexbody_x_grid_grd"]');
  return el ? el.value : "-1";
}

function getFirstRowText() {
  const table = document.getElementById("body_x_grid_grd");
  if (!table) return "";
  const firstDataRow =
    table.querySelector("tbody tr[data-object-type]") ||
    table.querySelector("tbody tr:first-child");
  if (!firstDataRow) return "";
  const firstCell =
    firstDataRow.querySelector('td[data-iv-role="cell"]') ||
    firstDataRow.querySelector("td");
  return firstCell ? firstCell.innerText.trim() : "";
}
