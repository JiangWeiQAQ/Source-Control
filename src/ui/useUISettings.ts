import { useState } from "scripting"
import { getUITokens, UITokens, UIDensity } from "./design"

export interface UISettings {
  density: UIDensity
}

const UI_DENSITY_KEY = "source-control.ui.density"
const DEFAULT_DENSITY: UIDensity = "standard"

export function getUIDensity(): UIDensity {
  const value = Storage.get<UIDensity>(UI_DENSITY_KEY)
  return value === "compact" || value === "standard" || value === "comfortable" ? value : DEFAULT_DENSITY
}

export function setUIDensity(value: UIDensity): void {
  Storage.set(UI_DENSITY_KEY, value)
}

export function useUISettings(): UISettings & { tokens: UITokens; setDensity: (density: UIDensity) => void } {
  const [density, setDensityState] = useState<UIDensity>(getUIDensity())
  const setDensity = (next: UIDensity) => {
    setUIDensity(next)
    setDensityState(next)
  }
  return { density, tokens: getUITokens(density), setDensity }
}

export { UI_DENSITY_KEY }
