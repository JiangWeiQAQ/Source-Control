import { Text } from "scripting"
import { GitChange } from "../../core/types"

export type ChangeStatusColor = "green" | "blue" | "red" | "orange"

export function getChangeStatusInfo(change: GitChange, untrackedLabel = "?", untrackedColor: ChangeStatusColor = "orange"): { label: string; color: ChangeStatusColor } {
  if (change.status === "added") return { label: "A", color: "green" }
  if (change.status === "deleted") return { label: "D", color: "red" }
  if (change.status === "untracked") return { label: untrackedLabel, color: untrackedColor }
  return { label: "M", color: "blue" }
}

export function ChangeStatusBadge({ change, untrackedLabel, untrackedColor }: { change: GitChange; untrackedLabel?: string; untrackedColor?: ChangeStatusColor }) {
  const info = getChangeStatusInfo(change, untrackedLabel, untrackedColor)
  return <Text font="caption" bold foregroundStyle={info.color}>{info.label}</Text>
}
