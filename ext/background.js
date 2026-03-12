// Background service worker — persists scrape state to chrome.storage.local
// so it survives service worker termination/restart.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  return true; // keep channel open for async response
});

async function handleMessage(msg) {
  const state = await getState();

  switch (msg.type) {
    case "START_SCRAPE":
      await saveState({
        status: "running",
        rows: [],
        headers: [],
        totalRecords: 0,
        pagesScraped: 0,
        totalPages: 0,
        error: null,
      });
      return { ok: true };

    case "RESUME_SCRAPE":
      state.status = "running";
      state.error = null;
      await saveState(state);
      return { ok: true, resumeFromPage: state.pagesScraped };

    case "SCRAPE_PROGRESS":
      if (state.status !== "running") return { ok: false };
      if (msg.headers && state.headers.length === 0) {
        state.headers = msg.headers;
      }
      if (msg.totalRecords) state.totalRecords = msg.totalRecords;
      if (msg.totalPages) state.totalPages = msg.totalPages;
      state.rows.push(...msg.rows);
      state.pagesScraped = msg.pagesScraped;
      await saveState(state);
      return { ok: true };

    case "SCRAPE_DONE":
      state.status = "done";
      state.pagesScraped = msg.pagesScraped || state.pagesScraped;
      await saveState(state);
      return { ok: true };

    case "SCRAPE_STOPPED":
      state.status = "stopped";
      state.pagesScraped = msg.pagesScraped || state.pagesScraped;
      state.error = msg.error || "Stopped — click Resume to continue.";
      await saveState(state);
      return { ok: true };

    case "SCRAPE_ERROR":
      state.status = "error";
      state.error = msg.error;
      await saveState(state);
      return { ok: true };

    case "GET_STATUS":
      return state;

    case "RESET":
      await saveState({
        status: "idle",
        rows: [],
        headers: [],
        totalRecords: 0,
        pagesScraped: 0,
        totalPages: 0,
        error: null,
      });
      return { ok: true };

    default:
      return { ok: false };
  }
}

async function getState() {
  const result = await chrome.storage.local.get("scrapeState");
  return (
    result.scrapeState || {
      status: "idle",
      rows: [],
      headers: [],
      totalRecords: 0,
      pagesScraped: 0,
      totalPages: 0,
      error: null,
    }
  );
}

async function saveState(state) {
  await chrome.storage.local.set({ scrapeState: state });
}
