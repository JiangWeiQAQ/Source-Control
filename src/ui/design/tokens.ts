import { densityPresets } from "./presets"

export type UIDensity = "compact" | "standard" | "comfortable"

export interface UITokens {
  pagePadding: number
  sectionSpacing: number
  cardPadding: number
  cardRadius: number
  rowHeight: number
  buttonHeight: number
  compareHorizontalPadding: number
  compareRowHeight: number
  compactPadding: number
  groupSpacing: number
  compactSpacing: number
  rowContentSpacing: number
  iconSize: number
  smallIconSize: number
  largeIconSize: number
  toolbarIconHitArea: number
  compactRowHeight: number
  largeActionRowHeight: number
  cardRowHeight: number
}

const sharedTokens: Omit<
  UITokens,
  "pagePadding" | "sectionSpacing" | "cardPadding" | "cardRadius" | "rowHeight" | "buttonHeight" | "compareHorizontalPadding" | "compareRowHeight"
> = {
  compactPadding: 8,
  groupSpacing: 8,
  compactSpacing: 4,
  rowContentSpacing: 8,
  iconSize: 20,
  smallIconSize: 16,
  largeIconSize: 28,
  toolbarIconHitArea: 44,
  compactRowHeight: 44,
  largeActionRowHeight: 58,
  cardRowHeight: 72,
}

export function getUITokens(density: UIDensity): UITokens {
  return { ...sharedTokens, ...densityPresets[density] }
}

export const uiTokens = getUITokens("standard")
export type UITokenName = keyof UITokens
