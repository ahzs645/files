import * as cheerio from "cheerio";

import type {
  OpportunityAddendum,
  OpportunityAttachment,
  OpportunityDetailScrape,
  OpportunityField
} from "../types";
import {
  dedupeStrings,
  extractProcessId,
  normalizeWhitespace,
  parseDateToIso,
  toAbsoluteUrl
} from "./utils";

const REMOVABLE_TEXT_SELECTORS = [
  "script",
  "style",
  "select",
  "noscript",
  "[type='hidden']",
  ".iv-menu-container",
  ".menu",
  ".dropdown.icon",
  ".dropdown-clear",
  ".sr-only",
  ".tooltip-field",
  "button"
].join(", ");

const FIELD_SELECTORS = ".iv-form-row, .iv-field-row, [data-iv-role='field'], .field.readonly";

/**
 * Extract clean visible text from a Cheerio element, stripping out script tags,
 * style tags, select/option dropdowns, hidden inputs, and grid-view JS noise
 * that BC Bid embeds inline in detail pages.
 */
function cleanText($: cheerio.CheerioAPI, el: ReturnType<cheerio.CheerioAPI>): string {
  const clone = el.clone();
  clone.find(REMOVABLE_TEXT_SELECTORS).remove();
  // Preserve word boundaries between rich-text paragraphs and line breaks.
  clone.find("br").replaceWith(" ");
  clone.find("p, div, li").append(" ");
  return normalizeWhitespace(clone.text());
}

/**
 * Returns true when a value looks like scraped noise rather than a real field value.
 * Typical noise: long runs of dropdown options, JS grid init code, or repeated timestamps.
 */
function isNoiseValue(value: string): boolean {
  // Contains JS grid initialization patterns
  if (/__ivCtrl\[/.test(value)) return true;
  // Contains long runs of AM/PM time options from time-picker dropdowns
  if (/(\d{1,2}:\d{2}:\d{2}\s*(AM|PM)\s*){4,}/i.test(value)) return true;
  // Published scopes and submission instructions can be much longer than 2,000
  // characters. Length alone is not evidence of dropdown or script noise.
  // Contains "Delete the value." or "Delete all values." UI control text
  if (/Delete (the|all) value/i.test(value)) return true;
  // Contains "See All" UI button text mixed in
  if (/See All(Delete|See all)/i.test(value)) return true;
  return false;
}

function isBoilerplateDescription(value: string): boolean {
  return /log in|register with bc bid|prepare a submission/i.test(value);
}

function hasHiddenStyle(el: ReturnType<cheerio.CheerioAPI>): boolean {
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.attr("style") ?? "");
}

function isHiddenContext($: cheerio.CheerioAPI, el: ReturnType<cheerio.CheerioAPI>): boolean {
  if (!el.length) {
    return true;
  }

  if (el.is(".hidden, [hidden], [aria-hidden='true']") || hasHiddenStyle(el)) {
    return true;
  }

  return el
    .parents()
    .toArray()
    .some((ancestor) => {
      const parent = $(ancestor);
      return parent.is(".hidden, [hidden], [aria-hidden='true']") || hasHiddenStyle(parent);
    });
}

function getTableHeaders($: cheerio.CheerioAPI, table: ReturnType<cheerio.CheerioAPI>): string[] {
  return table
    .find("thead th, thead td, tr:first-child th")
    .map((_, header) => normalizeWhitespace($(header).text()))
    .get()
    .filter(Boolean);
}

function getTableRows(table: ReturnType<cheerio.CheerioAPI>): ReturnType<cheerio.CheerioAPI> {
  const bodyRows = table.find("tbody tr");
  return bodyRows.length > 0 ? bodyRows : table.find("tr").slice(1);
}

function isAddendaTable(headers: string[]): boolean {
  const firstHeader = headers[0] ?? "";
  const secondHeader = headers[1] ?? "";
  return /^(addend(?:a|um)?|amendments?)$/i.test(firstHeader) && /\bdate\b/i.test(secondHeader);
}

function isAmendmentHistoryTable(headers: string[]): boolean {
  const firstHeader = headers[0] ?? "";
  const secondHeader = headers[1] ?? "";
  const thirdHeader = headers[2] ?? "";
  return /^(#|amendment\s*#?)$/i.test(firstHeader) && /\bamendment reason\b/i.test(secondHeader) && /\bdate\b/i.test(thirdHeader);
}

function isAttachmentMetadata(value: string): boolean {
  if (!value) {
    return true;
  }

  if (/^\d+$/.test(value)) {
    return true;
  }

  if (/^(yes|no|true|false)$/i.test(value)) {
    return true;
  }

  if (/^\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?)?$/i.test(value)) {
    return true;
  }

  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}$/i.test(value)) {
    return true;
  }

  return false;
}

function fileNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname.split("/").at(-1);
    return tail ? decodeURIComponent(tail) : null;
  } catch {
    const tail = url.split("?")[0]?.split("/").at(-1);
    return tail ? decodeURIComponent(tail) : null;
  }
}

function extractFieldLabel(el: ReturnType<cheerio.CheerioAPI>): string {
  const label = (el.find(".label-field").first().length ? el.find(".label-field").first() : el.find("label").first()).clone();
  label.find(".tooltip-field, .sr-only").remove();
  return normalizeWhitespace(label.text().replace(/[:*]$/, "")) ||
    normalizeWhitespace(el.find("[aria-label]").first().attr("aria-label") ?? "");
}

function extractFieldValue($: cheerio.CheerioAPI, field: ReturnType<cheerio.CheerioAPI>): string {
  const scopes = [
    field.find("[data-iv-role='controlWrapper']").first(),
    field.find(".control-wrapper").first(),
    field
  ].filter((scope) => scope.length > 0);

  for (const scope of scopes) {
    // CKEditor renders the same HTML as the hidden textarea. Read it once,
    // as text, instead of combining serialized markup with the rendered copy.
    const editor = scope.find(".cke_textarea_inline").filter((_, node) => !isHiddenContext($, $(node)));
    if (editor.length) {
      const value = cleanText($, editor);
      if (value && !isNoiseValue(value)) return value;
    }
    const inputValues = scope
      .find("input, textarea")
      .map((_, element) => {
        const input = $(element);
        const type = (input.attr("type") ?? "").toLowerCase();
        if (type === "hidden" || type === "checkbox" || type === "radio") {
          return "";
        }

        const value = input.val()?.toString() ?? input.attr("value") ?? input.text();
        return normalizeWhitespace(value);
      })
      .get()
      .filter((value) => value && !isNoiseValue(value));

    const clone = scope.clone();
    clone.find(".label-field, label, h1, h2, h3, h4, h5, h6, .default").remove();
    clone.find("input, textarea").remove();
    const textValue = cleanText($, clone);
    const value = normalizeWhitespace(dedupeStrings([...inputValues, textValue]).join(" "));

    if (value && !isNoiseValue(value)) {
      return value;
    }
  }

  return "";
}

function readFieldRows($: cheerio.CheerioAPI): OpportunityField[] {
  const fields = new Map<string, string>();
  let previousLabel = "";

  $(FIELD_SELECTORS).each((_, element) => {
    const el = $(element);
    if (isHiddenContext($, el)) {
      return;
    }

    let label = extractFieldLabel(el);
    const value = extractFieldValue($, el);
    // The host removes hidden textarea controls, including their aria-label.
    // BC Bid places this visible, unlabelled rich-text continuation immediately
    // after the Delivery of Submissions field (with hidden alternatives between).
    const submissionContinuation = el.is(".no-label.iv-html-type, .iv-no-label.iv-html-type")
      && /^(Delivery of Submissions|Additional Delivery Method Details)$/i.test(previousLabel)
      && (!label || label === "Additional Delivery Method Details");
    if (submissionContinuation) label = "Delivery of Submissions";
    if (label) previousLabel = label;

    if (!label || !value || value === label) {
      return;
    }

    if (isNoiseValue(value)) {
      return;
    }

    if (submissionContinuation && fields.has(label)) {
      const previous = fields.get(label)!;
      if (!previous.includes(value)) fields.set(label, [previous, value].join("\n\n"));
    } else if (!fields.has(label)) {
      fields.set(label, value);
    }
  });

  return [...fields.entries()].map(([label, value]) => ({ label, value }));
}

function readGridFields($: cheerio.CheerioAPI): OpportunityField[] {
  const fields = new Map<string, string>();

  $("table").each((_, element) => {
    const table = $(element);
    if (isHiddenContext($, table)) {
      return;
    }

    const headers = getTableHeaders($, table);
    if (headers.length === 0 || isAddendaTable(headers) || isAmendmentHistoryTable(headers) || table.find("a[href*='download_public']").length > 0) {
      return;
    }

    const rows = getTableRows(table);
    if (rows.length === 0) {
      return;
    }

    if (headers.length === 1) {
      const label = headers[0] ?? "";
      const values = dedupeStrings(
        rows
          .map((__, row) => cleanText($, $(row).find("td").first()))
          .get()
          .filter((value) => value && value !== label && !isNoiseValue(value))
      );

      if (label && values.length > 0 && !fields.has(label)) {
        fields.set(label, values.join(", "));
      }
      return;
    }

    if (rows.length !== 1) {
      return;
    }

    const cells = rows.first().find("td");
    headers.slice(0, cells.length).forEach((label, index) => {
      const value = cleanText($, cells.eq(index));
      if (!label || !value || value === label || isNoiseValue(value) || fields.has(label)) {
        return;
      }

      fields.set(label, value);
    });
  });

  return [...fields.entries()].map(([label, value]) => ({ label, value }));
}

function readAddenda($: cheerio.CheerioAPI, baseUrl: string): OpportunityAddendum[] {
  const addenda: OpportunityAddendum[] = [];
  const seen = new Set<string>();
  $("table").each((_, element) => {
    const table = $(element);
    const headers = getTableHeaders($, table);

    if (!isAddendaTable(headers) && !isAmendmentHistoryTable(headers)) {
      return;
    }

    getTableRows(table)
      .each((__, row) => {
        const cells = $(row).find("td");
        if (cells.length < 1) {
          return;
        }

        let title = "";
        let date: string | null = null;
        let link: string | null = null;

        if (isAmendmentHistoryTable(headers)) {
          const amendmentNumber = normalizeWhitespace($(cells[0]).text());
          const reason = normalizeWhitespace($(cells[1]).text());
          title = reason || (amendmentNumber ? `Amendment ${amendmentNumber}` : "");
          if (amendmentNumber && reason) {
            title = `Amendment ${amendmentNumber}: ${reason}`;
          }
          date = parseDateToIso(normalizeWhitespace($(cells[2]).text())) ?? null;
          link = toAbsoluteUrl(baseUrl, $(row).find("a[href*='download_public']").first().attr("href"));
        } else {
          title = normalizeWhitespace($(cells[0]).text());
          date = parseDateToIso(normalizeWhitespace($(cells[1]).text())) ?? null;
          link = toAbsoluteUrl(baseUrl, $(cells[0]).find("a[href]").attr("href"));
        }

        if (!title || /title/i.test(title)) {
          return;
        }

        const key = `${title}::${date ?? ""}::${link ?? ""}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);

        addenda.push({
          title,
          date,
          link
        });
      });
  });

  return addenda;
}

/** Grids nest inside layout tables; only the innermost table holds one row per record. */
function innermostTables($: cheerio.CheerioAPI, matches: (headers: string[]) => boolean) {
  return $("table")
    .toArray()
    .map((element) => $(element))
    .filter((table) => table.find("table").length === 0 && matches(getTableHeaders($, table)));
}

/**
 * Multi-use lists and newer notices post addenda as Q&A messages: title, message,
 * attached files and a "Created On" date. Their files stay in the attachment list.
 */
function readMessageAddenda($: cheerio.CheerioAPI, baseUrl: string): OpportunityAddendum[] {
  const addenda: OpportunityAddendum[] = [];
  const seen = new Set<string>();
  for (const table of innermostTables($, (headers) => headers.includes("Message") && headers.some((header) => /^created on\b/i.test(header)))) {
    // Column positions come from every header cell, including the blank title and file columns.
    const headers = table.find("thead tr").first().find("th, td").map((_, header) => normalizeWhitespace($(header).text())).get();
    const messageIndex = headers.indexOf("Message");
    const dateIndex = headers.findIndex((header) => /^created on\b/i.test(header));
    getTableRows(table).each((_, row) => {
      const cells = $(row).find("td");
      const title = normalizeWhitespace($(cells[Math.max(0, messageIndex - 1)]).text());
      if (!title) {
        return;
      }
      // Long messages show a truncated preview; the screen-reader copy holds the full text.
      const messageCell = $(cells[messageIndex]);
      const full = messageCell.find(".sr-only").first();
      const message = normalizeWhitespace(full.length ? full.text() : messageCell.text());
      const date = parseDateToIso(normalizeWhitespace($(cells[dateIndex]).text())) ?? null;
      const link = toAbsoluteUrl(baseUrl, $(row).find("a[href*='download_public']").first().attr("href"));
      const key = `${title}::${date ?? ""}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      addenda.push({ title, date, link, ...(message && message !== title ? { message } : {}) });
    });
  }
  return addenda;
}

/** Multi-use lists publish the suppliers who qualified, unless the owner marks the list confidential. */
function readQualifiedSuppliers($: cheerio.CheerioAPI): OpportunityField[] {
  const suppliers: string[] = [];
  for (const table of innermostTables($, (headers) => headers[0] === "Supplier Legal Name")) {
    getTableRows(table).each((_, row) => {
      const [legal, trading] = $(row).find("td").map((__, cell) => normalizeWhitespace($(cell).text())).get();
      if (legal) {
        suppliers.push(trading && trading.toLowerCase() !== legal.toLowerCase() ? `${legal} (${trading})` : legal);
      }
    });
  }
  const unique = dedupeStrings(suppliers);
  return unique.length ? [{ label: "Qualified Suppliers", value: unique.join("\n") }] : [];
}

function deriveAttachmentName(
  $: cheerio.CheerioAPI,
  anchor: ReturnType<cheerio.CheerioAPI>,
  url: string
): string {
  const anchorText = normalizeWhitespace(anchor.text());
  const row = anchor.closest("tr");

  if (row.length > 0) {
    const rowCandidates = dedupeStrings(
      row
        .find("td")
        .map((_, cell) => {
          const clone = $(cell).clone();
          clone.find("a[href], .default").remove();
          return cleanText($, clone);
        })
        .get()
        .filter((value) => value && !isAttachmentMetadata(value))
    );

    const rowTitle = rowCandidates.find((value) => value !== anchorText) ?? rowCandidates[0] ?? "";
    if (rowTitle && anchorText && rowTitle !== anchorText && !rowTitle.includes(anchorText) && !anchorText.includes(rowTitle)) {
      return `${rowTitle} - ${anchorText}`;
    }

    if (rowTitle) {
      return rowTitle;
    }
  }

  return anchorText || fileNameFromUrl(url) || "Attachment";
}

function readAttachments($: cheerio.CheerioAPI, baseUrl: string, excludedUrls: Set<string>): OpportunityAttachment[] {
  const attachments = new Map<string, OpportunityAttachment>();

  $("a[href*='download_public']").each((_, element) => {
    const anchor = $(element);
    if (isHiddenContext($, anchor)) {
      return;
    }

    const url = toAbsoluteUrl(baseUrl, anchor.attr("href"));
    if (!url || excludedUrls.has(url)) {
      return;
    }

    if (!attachments.has(url)) {
      attachments.set(url, {
        url,
        name: deriveAttachmentName($, anchor, url)
      });
    }
  });

  return [...attachments.values()];
}

function mergeFields(...collections: OpportunityField[][]): OpportunityField[] {
  const fields = new Map<string, string>();

  for (const collection of collections) {
    for (const field of collection) {
      if (!fields.has(field.label)) {
        fields.set(field.label, field.value);
      }
    }
  }

  return [...fields.entries()].map(([label, value]) => ({ label, value }));
}

export function parseDetailPage(html: string, baseUrl: string, pageUrl: string): OpportunityDetailScrape {
  const $ = cheerio.load(html);
  const detailFields = mergeFields(readFieldRows($), readGridFields($), readQualifiedSuppliers($))
    // An email field without an address picked up neighbouring form text.
    .filter((field) => !/^e-?mail( address)?$/i.test(field.label) || field.value.includes("@"));
  const classicAddenda = readAddenda($, baseUrl);
  const attachments = readAttachments(
    $,
    baseUrl,
    new Set(classicAddenda.flatMap((addendum) => (addendum.link ? [addendum.link] : [])))
  );
  const addenda = [...classicAddenda, ...readMessageAddenda($, baseUrl)];

  let descriptionText = detailFields.find((field) => /^summary details$/i.test(field.label))?.value ?? "";
  const specificDescriptionEl = $("[data-testid='description'], [class*='description'], [id*='description']").first();
  if (!descriptionText && specificDescriptionEl.length > 0) {
    descriptionText = cleanText($, specificDescriptionEl);
  }

  if (!descriptionText || isNoiseValue(descriptionText) || isBoilerplateDescription(descriptionText)) {
    descriptionText =
      detailFields.find((field) => /summary details/i.test(field.label))?.value ||
      detailFields.find((field) => /^(opportunity )?description$/i.test(field.label))?.value ||
      "";
  }

  if (!descriptionText || isNoiseValue(descriptionText) || isBoilerplateDescription(descriptionText)) {
    const genericDescriptionEl = $(".iv-rich-text, .iv-html").first();
    descriptionText = genericDescriptionEl.length ? cleanText($, genericDescriptionEl) : "";
  }

  const processId =
    extractProcessId(pageUrl) ||
    extractProcessId(
      $("a[href*='process_manage_extranet']")
        .map((_, element) => $(element).attr("href") ?? "")
        .get()
        .join(" ")
    );

  return {
    processId,
    detailUrl: pageUrl,
    descriptionText,
    detailFields,
    addenda,
    attachments,
    sourceCapturedAt: new Date().toISOString()
  };
}
