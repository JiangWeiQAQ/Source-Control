import type { UIDensity, UITokens } from "./tokens"

export const densityPresets: Record<
  UIDensity,
  Pick<
    UITokens,
    "pagePadding" | "sectionSpacing" | "cardPadding" | "cardRadius" | "rowHeight" | "buttonHeight" | "compareHorizontalPadding" | "compareRowHeight"
  >
> = {
  compact: { pagePadding: 14, sectionSpacing: 12, cardPadding: 12, cardRadius: 10, rowHeight: 46, buttonHeight: 40, compareHorizontalPadding: 10, compareRowHeight: 78 },
  standard: { pagePadding: 16, sectionSpacing: 16, cardPadding: 14, cardRadius: 12, rowHeight: 52, buttonHeight: 44, compareHorizontalPadding: 12, compareRowHeight: 84 },
  comfortable: { pagePadding: 20, sectionSpacing: 20, cardPadding: 16, cardRadius: 14, rowHeight: 58, buttonHeight: 48, compareHorizontalPadding: 14, compareRowHeight: 92 },
}
