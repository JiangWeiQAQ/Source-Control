import { useEffect, useState } from "scripting"
import { AppLanguage, createTranslator, getLanguagePreference, resolveLanguage, setLanguagePreference } from "./localization"

export function useAppLanguage(): { language: AppLanguage; refreshLanguage: () => void } {
  const [language, setLanguage] = useState<AppLanguage>(() => resolveLanguage())
  const refreshLanguage = () => setLanguage(resolveLanguage())
  useEffect(() => {
    setLanguage(resolveLanguage(getLanguagePreference()))
  }, [])
  return { language, refreshLanguage }
}

export function useTranslator(): { language: AppLanguage; t: ReturnType<typeof createTranslator>; refreshLanguage: () => void } {
  const { language, refreshLanguage } = useAppLanguage()
  return { language, t: createTranslator(language), refreshLanguage }
}

export { createTranslator, getLanguagePreference, resolveLanguage, setLanguagePreference }
export type { AppLanguage, LanguagePreference, MessageKey } from "./localization"
