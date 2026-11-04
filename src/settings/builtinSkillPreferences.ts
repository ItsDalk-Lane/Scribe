import {
  getSettings,
  sanitizeBuiltinPreferences,
  setSettings,
  type ScribeSettings,
} from "@/settings/model";
import {
  persistSettingsWithinTransaction,
  runPersistenceTransaction,
} from "@/services/settingsPersistence";

export type BuiltinPreferences = NonNullable<
  ScribeSettings["agentMode"]["skills"]["builtinPreferences"]
>;
export type BuiltinPreferencesUpdate = (current: BuiltinPreferences) => BuiltinPreferences;
const EMPTY_PREFERENCES: BuiltinPreferences = Object.freeze({});
let preferenceWrites: Promise<void> = Promise.resolve();

export async function saveBuiltinPreferences(
  update: BuiltinPreferencesUpdate,
  saveData: (data: ScribeSettings) => Promise<void>
): Promise<BuiltinPreferences> {
  const result = preferenceWrites.then(async () => {
    let preferences: BuiltinPreferences = EMPTY_PREFERENCES;
    await runPersistenceTransaction(async () => {
      const previous = getSettings();
      const current = previous.agentMode.skills.builtinPreferences ?? EMPTY_PREFERENCES;
      const updated = update(current);
      preferences = sanitizeBuiltinPreferences(updated);
      for (const name of Object.keys(preferences)) {
        if (current[name] && updated[name] === current[name]) preferences[name] = current[name];
      }
      await persistSettingsWithinTransaction(
        {
          ...previous,
          agentMode: {
            ...previous.agentMode,
            skills: { ...previous.agentMode.skills, builtinPreferences: preferences },
          },
        },
        saveData,
        previous
      );
    });
    setSettings((current) => ({
      agentMode: {
        ...current.agentMode,
        skills: { ...current.agentMode.skills, builtinPreferences: preferences },
      },
    }));
    return preferences;
  });
  preferenceWrites = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
