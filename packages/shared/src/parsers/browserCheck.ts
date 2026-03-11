import * as cheerio from "cheerio";

import type { BrowserCheckPageState } from "../types";
import { normalizeWhitespace } from "./utils";

export function parseBrowserCheckPage(html: string): BrowserCheckPageState {
  const $ = cheerio.load(html);
  const title = normalizeWhitespace($("title").first().text());
  const message = normalizeWhitespace($("#body_x_lblMessage, .maintitle, h1").first().text()) || null;

  return {
    isBrowserCheck: /browser check/i.test(title) || /browser check/i.test(message ?? ""),
    message,
    hasCaptcha:
      $("script[src*='recaptcha']").length > 0 ||
      $("input[name='captcha_response']").length > 0 ||
      /ivCaptcha/.test(html)
  };
}
