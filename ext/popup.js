const btnScrape = document.getElementById("btnScrape");
const btnResume = document.getElementById("btnResume");
const btnCsv = document.getElementById("btnCsv");
const btnJson = document.getElementById("btnJson");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const statusIcon = document.getElementById("statusIcon");
const progressBar = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const statsEl = document.getElementById("stats");

let pollTimer = null;

function setStatus(message, type) {
  statusText.textContent = message;
  statusEl.className = "status" + (type ? " " + type : "");
  if (type === "error") {
    statusIcon.textContent = "\u2716";
  } else if (type === "success") {
    statusIcon.textContent = "\u2714";
  } else if (type === "warning") {
    statusIcon.textContent = "\u26A0";
  } else {
    statusIcon.textContent = "\u2139";
  }
}

function setProgress(current, total) {
  if (total === 0) {
    progressBar.classList.remove("active");
    return;
  }
  progressBar.classList.add("active");
  const pct = Math.min(100, Math.round((current / total) * 100));
  progressFill.style.width = pct + "%";
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    updateUI(state);
    if (
      state.status === "done" ||
      state.status === "error" ||
      state.status === "stopped"
    ) {
      stopPolling();
    }
  }, 500);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function updateUI(state) {
  // Hide resume by default
  btnResume.style.display = "none";

  switch (state.status) {
    case "idle":
      setStatus(
        "Navigate to BC Bid contract browse page, then click Scrape.",
        null
      );
      setProgress(0, 0);
      btnScrape.disabled = false;
      btnScrape.textContent = "Scrape All Pages";
      btnCsv.disabled = true;
      btnJson.disabled = true;
      statsEl.textContent = "";
      break;

    case "running": {
      const pg = state.pagesScraped || 0;
      const total = state.totalPages || "?";
      const rows = state.rows ? state.rows.length : 0;
      setStatus(
        `Scraping... page ${pg} of ~${total} (${rows} rows so far). You can close this popup.`,
        null
      );
      if (state.totalPages > 0) {
        setProgress(pg, state.totalPages);
      } else {
        setProgress(pg, pg + 1);
      }
      btnScrape.disabled = true;
      btnScrape.textContent = "Scraping...";
      btnCsv.disabled = true;
      btnJson.disabled = true;
      statsEl.textContent = state.totalRecords
        ? `${state.totalRecords} total records expected`
        : "";
      break;
    }

    case "stopped": {
      const rowCount = state.rows ? state.rows.length : 0;
      const totalNote = state.totalRecords
        ? ` of ${state.totalRecords}`
        : "";
      setStatus(
        `Paused: ${rowCount}${totalNote} records scraped (${state.pagesScraped} pages). ${state.error || ""}`,
        "warning"
      );
      if (state.totalPages > 0) {
        setProgress(state.pagesScraped, state.totalPages);
      }
      btnScrape.disabled = false;
      btnScrape.textContent = "Start Over";
      btnResume.style.display = "block";
      btnResume.disabled = false;
      // Allow export of partial data
      btnCsv.disabled = rowCount === 0;
      btnJson.disabled = rowCount === 0;
      statsEl.textContent = `${(state.headers || []).length} columns \u00b7 ${rowCount} rows so far`;
      break;
    }

    case "done": {
      const rowCount = state.rows ? state.rows.length : 0;
      const expectedNote = state.totalRecords
        ? ` (${state.totalRecords} expected)`
        : "";
      setStatus(
        `Done! Scraped ${rowCount} records from ${state.pagesScraped} page(s).${expectedNote}`,
        "success"
      );
      setProgress(1, 1);
      btnScrape.disabled = false;
      btnScrape.textContent = "Scrape Again";
      btnCsv.disabled = false;
      btnJson.disabled = false;
      statsEl.textContent = `${(state.headers || []).length} columns \u00b7 ${rowCount} rows`;
      break;
    }

    case "error":
      setStatus("Error: " + state.error, "error");
      setProgress(0, 0);
      btnScrape.disabled = false;
      btnScrape.textContent = "Retry Scrape";
      btnCsv.disabled = true;
      btnJson.disabled = true;
      statsEl.textContent = "";
      break;
  }
}

// Start fresh scrape
btnScrape.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "RESET" });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes("bcbid.gov.bc.ca")) {
    setStatus("Please navigate to a BC Bid page first.", "error");
    return;
  }

  await chrome.runtime.sendMessage({ type: "START_SCRAPE" });
  await triggerContentScript(tab.id, { type: "TRIGGER_SCRAPE" });
  startPolling();
});

// Resume from where we stopped
btnResume.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes("bcbid.gov.bc.ca")) {
    setStatus("Please navigate to a BC Bid page first.", "error");
    return;
  }

  const result = await chrome.runtime.sendMessage({ type: "RESUME_SCRAPE" });
  const resumePage = result.resumeFromPage || 0;

  await triggerContentScript(tab.id, {
    type: "TRIGGER_SCRAPE",
    resumeFromPage: resumePage,
  });
  startPolling();
});

async function triggerContentScript(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (err) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    try {
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (err2) {
      setStatus("Failed to start scrape: " + err2.message, "error");
    }
  }
}

btnCsv.addEventListener("click", async () => {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  if (!state || !state.rows || state.rows.length === 0) return;
  const csv = toCsv(state.headers, state.rows);
  downloadFile(csv, "bc-bid-contracts.csv", "text/csv");
});

btnJson.addEventListener("click", async () => {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  if (!state || !state.rows || state.rows.length === 0) return;
  const objects = state.rows.map((row) =>
    Object.fromEntries(state.headers.map((h, i) => [h, row[i] || ""]))
  );
  const json = JSON.stringify(objects, null, 2);
  downloadFile(json, "bc-bid-contracts.json", "application/json");
});

function toCsv(headers, rows) {
  const escape = (val) => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) {
    lines.push(row.map(escape).join(","));
  }
  return lines.join("\r\n");
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// On popup open, check existing state
(async () => {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  updateUI(state);
  if (state.status === "running") {
    startPolling();
  }
})();
