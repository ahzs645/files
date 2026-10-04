/**
 * Procurement sites we cannot collect from (sign-in walls, no public listing, terms), listed so people can check
 * them by hand. The BC sources stream owns the entries; this module only fixes the shape the Sources page reads.
 */
export interface LinkSource {
  id: string;
  /** The buyer or site as it names itself. */
  label: string;
  /** https page a person can open. */
  url: string;
  /** Municipality, regional district or other area, when known. */
  region?: string;
  /** Why it is not collected, in a few words (e.g. "Sign-in required"). */
  reason?: string;
}

export const LINK_SOURCES: readonly LinkSource[] = [];
