export const PLACEHOLDER_CONTRACT_AWARD_SUPPLIERS = new Set([
  "migrated supplier",
]);

function normalizeText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

export function normalizeContractAwardEntityLabel(
  value: string | null | undefined,
): string | null {
  return normalizeText(value);
}

export function isPlaceholderContractAwardSupplier(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeContractAwardEntityLabel(value);
  if (!normalized) {
    return true;
  }

  return PLACEHOLDER_CONTRACT_AWARD_SUPPLIERS.has(normalized.toLowerCase());
}

export function buildContractAwardEntityKey(
  value: string | null | undefined,
): string {
  const normalized = normalizeContractAwardEntityLabel(value) ?? "unknown";
  return normalized
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function parseContractAwardDate(
  value: string | null | undefined,
): Date | null {
  const normalized = normalizeContractAwardEntityLabel(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
