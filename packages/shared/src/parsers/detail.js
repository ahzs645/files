import * as cheerio from "cheerio";
import { dedupeStrings, extractProcessId, normalizeWhitespace, parseDateToIso, toAbsoluteUrl } from "./utils";
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
const FIELD_SELECTORS = ".iv-form-row, .iv-field-row, [data-iv-role='field']";
/**
 * Extract clean visible text from a Cheerio element, stripping out script tags,
 * style tags, select/option dropdowns, hidden inputs, and grid-view JS noise
 * that BC Bid embeds inline in detail pages.
 */
function cleanText($, el) {
    const clone = el.clone();
    clone.find(REMOVABLE_TEXT_SELECTORS).remove();
    return normalizeWhitespace(clone.text());
}
/**
 * Returns true when a value looks like scraped noise rather than a real field value.
 * Typical noise: long runs of dropdown options, JS grid init code, or repeated timestamps.
 */
function isNoiseValue(value) {
    // Contains JS grid initialization patterns
    if (/__ivCtrl\[/.test(value))
        return true;
    // Contains long runs of AM/PM time options from time-picker dropdowns
    if (/(\d{1,2}:\d{2}:\d{2}\s*(AM|PM)\s*){4,}/i.test(value))
        return true;
    // Unreasonably long for a single field value (real values are rarely >2000 chars)
    if (value.length > 2000)
        return true;
    // Contains "Delete the value." or "Delete all values." UI control text
    if (/Delete (the|all) value/i.test(value))
        return true;
    // Contains "See All" UI button text mixed in
    if (/See All(Delete|See all)/i.test(value))
        return true;
    return false;
}
function isBoilerplateDescription(value) {
    return /log in|register with bc bid|prepare a submission/i.test(value);
}
function hasHiddenStyle(el) {
    return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.attr("style") ?? "");
}
function isHiddenContext($, el) {
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
function getTableHeaders($, table) {
    return table
        .find("thead th, thead td, tr:first-child th")
        .map((_, header) => normalizeWhitespace($(header).text()))
        .get()
        .filter(Boolean);
}
function getTableRows(table) {
    const bodyRows = table.find("tbody tr");
    return bodyRows.length > 0 ? bodyRows : table.find("tr").slice(1);
}
function isAddendaTable(headers) {
    const firstHeader = headers[0] ?? "";
    const secondHeader = headers[1] ?? "";
    return /^(addend(?:a|um)?|amendments?)$/i.test(firstHeader) && /\bdate\b/i.test(secondHeader);
}
function isAmendmentHistoryTable(headers) {
    const firstHeader = headers[0] ?? "";
    const secondHeader = headers[1] ?? "";
    const thirdHeader = headers[2] ?? "";
    return /^(#|amendment\s*#?)$/i.test(firstHeader) && /\bamendment reason\b/i.test(secondHeader) && /\bdate\b/i.test(thirdHeader);
}
function isAttachmentMetadata(value) {
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
function fileNameFromUrl(url) {
    try {
        const parsed = new URL(url);
        const tail = parsed.pathname.split("/").at(-1);
        return tail ? decodeURIComponent(tail) : null;
    }
    catch {
        const tail = url.split("?")[0]?.split("/").at(-1);
        return tail ? decodeURIComponent(tail) : null;
    }
}
function extractFieldLabel(el) {
    return normalizeWhitespace(el
        .find(".label-field, label")
        .first()
        .text()
        .replace(/[:*]$/, ""));
}
function extractFieldValue($, field) {
    const scopes = [
        field.find("[data-iv-role='controlWrapper']").first(),
        field.find(".control-wrapper").first(),
        field
    ].filter((scope) => scope.length > 0);
    for (const scope of scopes) {
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
function readFieldRows($) {
    const fields = new Map();
    $(FIELD_SELECTORS).each((_, element) => {
        const el = $(element);
        if (isHiddenContext($, el)) {
            return;
        }
        const label = extractFieldLabel(el);
        const value = extractFieldValue($, el);
        if (!label || !value || value === label) {
            return;
        }
        if (isNoiseValue(value)) {
            return;
        }
        if (!fields.has(label)) {
            fields.set(label, value);
        }
    });
    return [...fields.entries()].map(([label, value]) => ({ label, value }));
}
function readGridFields($) {
    const fields = new Map();
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
            const values = dedupeStrings(rows
                .map((__, row) => cleanText($, $(row).find("td").first()))
                .get()
                .filter((value) => value && value !== label && !isNoiseValue(value)));
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
function readAddenda($, baseUrl) {
    const addenda = [];
    const seen = new Set();
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
            let date = null;
            let link = null;
            if (isAmendmentHistoryTable(headers)) {
                const amendmentNumber = normalizeWhitespace($(cells[0]).text());
                const reason = normalizeWhitespace($(cells[1]).text());
                title = reason || (amendmentNumber ? `Amendment ${amendmentNumber}` : "");
                if (amendmentNumber && reason) {
                    title = `Amendment ${amendmentNumber}: ${reason}`;
                }
                date = parseDateToIso(normalizeWhitespace($(cells[2]).text())) ?? null;
                link = toAbsoluteUrl(baseUrl, $(row).find("a[href*='download_public']").first().attr("href"));
            }
            else {
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
function deriveAttachmentName($, anchor, url) {
    const anchorText = normalizeWhitespace(anchor.text());
    const row = anchor.closest("tr");
    if (row.length > 0) {
        const rowCandidates = dedupeStrings(row
            .find("td")
            .map((_, cell) => {
            const clone = $(cell).clone();
            clone.find("a[href], .default").remove();
            return cleanText($, clone);
        })
            .get()
            .filter((value) => value && !isAttachmentMetadata(value)));
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
function readAttachments($, baseUrl, excludedUrls) {
    const attachments = new Map();
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
function mergeFields(...collections) {
    const fields = new Map();
    for (const collection of collections) {
        for (const field of collection) {
            if (!fields.has(field.label)) {
                fields.set(field.label, field.value);
            }
        }
    }
    return [...fields.entries()].map(([label, value]) => ({ label, value }));
}
export function parseDetailPage(html, baseUrl, pageUrl) {
    const $ = cheerio.load(html);
    const detailFields = mergeFields(readFieldRows($), readGridFields($));
    const addenda = readAddenda($, baseUrl);
    const attachments = readAttachments($, baseUrl, new Set(addenda.flatMap((addendum) => (addendum.link ? [addendum.link] : []))));
    let descriptionText = "";
    const specificDescriptionEl = $("[data-testid='description'], [class*='description'], [id*='description']").first();
    if (specificDescriptionEl.length > 0) {
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
    const processId = extractProcessId(pageUrl) ||
        extractProcessId($("a[href*='process_manage_extranet']")
            .map((_, element) => $(element).attr("href") ?? "")
            .get()
            .join(" "));
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
