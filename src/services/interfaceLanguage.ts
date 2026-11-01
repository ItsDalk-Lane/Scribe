import { resolveInterfaceLocale, setInterfaceLocale, type InterfaceLocale } from "@/lib/i18n";
import { getLanguage } from "obsidian";

export function initializeInterfaceLanguage(
  readObsidianLanguage: () => string = getLanguage,
  readSystemLanguage: () => string = () => navigator.language
): InterfaceLocale {
  let obsidianLanguage: string | undefined;
  let systemLanguage: string | undefined;
  try {
    obsidianLanguage = readObsidianLanguage();
  } catch {
    obsidianLanguage = undefined;
  }
  if (!obsidianLanguage?.trim()) {
    try {
      systemLanguage = readSystemLanguage();
    } catch {
      systemLanguage = undefined;
    }
  }
  const language = resolveInterfaceLocale(obsidianLanguage, systemLanguage);
  setInterfaceLocale(language);
  return language;
}
