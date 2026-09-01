export function formatHistoryTime(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const now = new Date()

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const isSameYear = date.getFullYear() === now.getFullYear()
  const pad = (value: number) => String(value).padStart(2, "0")
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`

  if (isToday) return time

  const month = date.getMonth() + 1
  const day = date.getDate()
  if (isSameYear) return `${month}月${day}日 ${time}`

  return `${date.getFullYear()}年${month}月${day}日`
}
