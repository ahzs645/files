import { v } from "convex/values";

import { action } from "./_generated/server";

async function postInternal(path: string, body: unknown) {
  const baseUrl = process.env.SCRAPER_INTERNAL_BASE_URL;
  const token = process.env.SCRAPER_INTERNAL_TOKEN;

  if (!baseUrl || !token) {
    throw new Error(
      "Missing SCRAPER_INTERNAL_BASE_URL or SCRAPER_INTERNAL_TOKEN in Convex environment variables.",
    );
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": token,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `Scraper request failed with status ${response.status}.`);
  }

  return payload;
}

export const start = action({
  args: {
    sourcePath: v.string(),
    resetState: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    return await postInternal("/internal/contract-awards/import/start", {
      sourcePath: args.sourcePath,
      resetState: args.resetState ?? false,
    });
  },
});

export const status = action({
  args: {},
  handler: async () => {
    return await postInternal("/internal/contract-awards/import/status", {});
  },
});

export const stop = action({
  args: {},
  handler: async () => {
    return await postInternal("/internal/contract-awards/import/stop", {});
  },
});
