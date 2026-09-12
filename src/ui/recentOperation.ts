export type RecentOperationKind = "commit" | "push" | "force-push" | "restore" | "reset" | "release"

export type RecentOperationDestination =
  | { kind: "commit-detail"; oid: string; shortOid?: string }
  | { kind: "remote" }
  | { kind: "release" }

export interface RecentOperation {
  kind: RecentOperationKind
  identifier: string
  destination?: RecentOperationDestination
  onPress?: () => void
}

export type RecentOperationHandler = (operation: RecentOperation) => void
