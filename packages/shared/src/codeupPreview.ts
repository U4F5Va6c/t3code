/** Fork acceptance builds have their own application and runtime identity. */
export const CODEUP_PREVIEW = {
  repository: "U4F5Va6c/t3code",
  appId: "io.github.u4f5va6c.t3code.codeup-preview",
  productName: "T3 Code (Codeup Preview)",
  scheme: "t3code-codeup-preview",
  profile: "t3code-codeup-preview",
  home: ".t3-codeup-preview",
  serviceHome: ".t3-codeup",
  serviceUnit: "t3code-codeup.service",
  serviceLabel: "io.github.u4f5va6c.t3code.codeup.service",
} as const;

export const isCodeupPreviewVersion = (version: string | undefined): boolean =>
  version !== undefined && /^[^-+]+-codeup\.\d{8}\.\d+$/u.test(version);
