export type RecentOperationKind = "commit" | "push" | "force-push" | "restore" | "reset" | "release"

export interface RecentOperation {
  kind: RecentOperationKind
  identifier: string
}

export type RecentOperationHandler = (operation: RecentOperation) => void
