export const COMMIT_MESSAGE_MAX_LENGTH = 72

export type CommitTitleValidationError = "empty" | "multiline" | "too-long"

export interface CommitTitleValidationResult {
  value: string
  error: CommitTitleValidationError | null
}

export function validateCommitTitle(input: string): CommitTitleValidationResult {
  const value = input.trim()
  if (!value) return { value, error: "empty" }
  if (/\r|\n/.test(value)) return { value, error: "multiline" }
  if (Array.from(value).length > COMMIT_MESSAGE_MAX_LENGTH) return { value, error: "too-long" }
  return { value, error: null }
}
