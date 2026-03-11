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

/**
 * Extract clean visible text from a Cheerio element, stripping out script tags,
 * style tags, select/option dropdowns, hidden inputs, and grid-view JS noise
 * that BC Bid embeds inline in detail pages.
 */
function cleanText($: cheerio.CheerioAPI, el: ReturnType<cheerio.CheerioAPI>): string {
  const clone = el.clone();
  clone.find("script, style, select, noscript, [type='hidden']").remove();
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
  // Unreasonably long for a single field value (real values are rarely >2000 chars)
  if (value.length > 2000) return true;
  // Contains "Delete the value." or "Delete all values." UI control text
  if (/Delete (the|all) value/i.test(value)) return true;
  // Contains "See All" UI button text mixed in
  if (/See All(Delete|See all)/i.test(value)) return true;
  return false;
}

function readFieldRows($: cheerio.CheerioAPI): OpportunityField[] {
  const fields = new Map<string, string>();

  $(".iv-form-row, .iv-field-row").each((_, element) => {
    const el = $(element);
    const label = normalizeWhitespace(
      el
        .find(".iv-field-label, .label-field, label")
        .first()
        .text()
        .replace(/[:*]$/, "")
    );

    const valueEl = el
      .find(".iv-field-value, .readonly, .iv-field-text")
      .not(".label-field")
      .first();

    const value = cleanText($, valueEl);

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

function readAddenda($: cheerio.CheerioAPI, baseUrl: string): OpportunityAddendum[] {
  const addenda: OpportunityAddendum[] = [];
  $("table").each((_, element) => {
    const tableText = normalizeWhitespace($(element).text());
    if (!/addend|amend/i.test(tableText)) {
      return;
    }

    $(element)
      .find("tbody tr")
      .each((__, row) => {
        const cells = $(row).find("td");
        if (cells.length < 1) {
          return;
        }

        const title = normalizeWhitespace($(cells[0]).text());
        if (!title || /title/i.test(title)) {
          return;
        }

        addenda.push({
          title,
          date: parseDateToIso(normalizeWhitespace($(cells[1]).text())) ?? null,
          link: toAbsoluteUrl(baseUrl, $(cells[0]).find("a[href]").attr("href"))
        });
      });
  });

  return addenda;
}

function readAttachments($: cheerio.CheerioAPI, baseUrl: string): OpportunityAttachment[] {
  return dedupeStrings(
    $("a[href*='download_public']")
      .map((_, element) => toAbsoluteUrl(baseUrl, $(element).attr("href")) ?? "")
      .get()
  ).map((url) => ({
    url,
    name:
      normalizeWhitespace($(`a[href='${url}']`).first().text()) ||
      normalizeWhitespace($(`a[href$='${url.split("/").at(-1) ?? ""}']`).first().text()) ||
      "Attachment"
  }));
}

export function parseDetailPage(html: string, baseUrl: string, pageUrl: string): OpportunityDetailScrape {
  const $ = cheerio.load(html);
  const detailFields = readFieldRows($);

  const descriptionEl = $("[data-testid='description'], [class*='description'], [id*='description'], .iv-rich-text, .iv-html").first();
  let descriptionText = descriptionEl.length ? cleanText($, descriptionEl) : "";
  if (!descriptionText || isNoiseValue(descriptionText)) {
    descriptionText = detailFields.find((field) => /description/i.test(field.label))?.value || "";
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
    addenda: readAddenda($, baseUrl),
    attachments: readAttachments($, baseUrl),
    sourceCapturedAt: new Date().toISOString()
  };
}
