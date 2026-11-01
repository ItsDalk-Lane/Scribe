import { agentTranslations } from "@/lib/locales/agent";
import { componentTranslations } from "@/lib/locales/components";
import { runtimeTranslations } from "@/lib/locales/runtime";
import { settingsTranslations } from "@/lib/locales/settings";

export type InterfaceLocale = "en" | "zh-CN";
export type TranslationParams = Readonly<Record<string, string | number>>;

export const chineseTranslations: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, string>, {
    ...runtimeTranslations,
    ...agentTranslations,
    ...componentTranslations,
    ...settingsTranslations,
  })
);

let locale: InterfaceLocale = "en";

export function resolveInterfaceLocale(
  obsidianLanguage: string | undefined,
  systemLanguage: string | undefined
): InterfaceLocale {
  const language = (obsidianLanguage?.trim() || systemLanguage?.trim() || "en")
    .replace(/_/g, "-")
    .toLowerCase();
  return language === "zh" || language.startsWith("zh-") ? "zh-CN" : "en";
}

export function setInterfaceLocale(value: InterfaceLocale): void {
  locale = value;
}

export function getInterfaceLocale(): InterfaceLocale {
  return locale;
}

export function translate(
  language: InterfaceLocale,
  english: string,
  params?: TranslationParams
): string {
  const text = language === "zh-CN" ? (chineseTranslations[english] ?? english) : english;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    params && Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : placeholder
  );
}

export function t(english: string, params?: TranslationParams): string {
  return translate(locale, english, params);
}
