import fs from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

export async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function createRunArtifactDir(baseDir: string, runId: string) {
  const runDir = path.join(baseDir, runId);
  await ensureDir(runDir);
  return runDir;
}

export async function writeArtifact(
  runDir: string,
  filename: string,
  contents: string | Buffer
) {
  const target = path.join(runDir, filename);
  await fs.writeFile(target, contents);
  return target;
}

export async function capturePageArtifacts(
  page: Page,
  runDir: string,
  name: string
): Promise<{ htmlPath: string; screenshotPath: string }> {
  const safeName = name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const htmlPath = await writeArtifact(runDir, `${safeName}.html`, await page.content());
  const screenshotPath = path.join(runDir, `${safeName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return { htmlPath, screenshotPath };
}
