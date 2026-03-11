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

function readFieldRows($: cheerio.CheerioAPI): OpportunityField[] {
  const fields = new Map<string, string>();

  $(".iv-form-row, .iv-field-row, .field, tr").each((_, element) => {
    const label = normalizeWhitespace(
      $(element)
        .find(".iv-field-label, .label-field, th, label")
        .first()
        .text()
        .replace(/[:*]$/, "")
    );

    let value = normalizeWhitespace(
      $(element)
        .find(".iv-field-value, .readonly, .iv-field-text, td, .control-wrapper")
        .not(".label-field")
        .first()
        .text()
    );

    if (!label || !value || value === label) {
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
  const descriptionText =
    normalizeWhitespace(
      $("[data-testid='description'], [class*='description'], [id*='description'], .iv-rich-text, .iv-html")
        .first()
        .text()
    ) ||
    detailFields.find((field) => /description/i.test(field.label))?.value ||
    "";

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
