import { GitSafety } from "../GitSafety"

export function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function formatGitError(error: unknown, fallbackAction: string): string {
  return GitSafety.formatErrorMessage(error, fallbackAction)
}
