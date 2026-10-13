/**
 * License seam. Folio is commercial software; this build does not yet check a
 * key. A later edition replaces `uncheckedLicense` and keeps `licenseBlocks`
 * as the only gate in front of the press.
 */
export type LicenseState = "unchecked" | "valid" | "invalid" | "expired";

export type LicenseStatus = {
  state: LicenseState;
  holder?: string;
};

export interface LicensePort {
  check(): Promise<LicenseStatus>;
}

export const uncheckedLicense: LicensePort = {
  async check() {
    return { state: "unchecked" };
  },
};

export function licenseBlocks(status: LicenseStatus): boolean {
  return status.state === "invalid" || status.state === "expired";
}
