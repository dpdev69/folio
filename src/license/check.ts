/**
 * License seam, left from before Folio was open source (MIT). It checks no key:
 * `uncheckedLicense` is all there is, and `licenseBlocks` never stops the press.
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
