# Translations

User-facing strings live here, grouped by namespace and language.

```
locales/
  en/
    common.json         # shared primitives (actions, states, units)
    wallet.json         # wallet setup / unlock
    nodeSync.json       # node bootstrap + sync page
    dashboard.json      # tab labels
    settings.json       # Settings page
    modals.json         # modal strings (validation, titles)
    errors.json         # friendly error messages (keyed by pattern)
    notifications.json  # toast + desktop notification copy
```

## Adding a new language

1. Pick the ISO 639-1 code (e.g. `fr`, `es`, `ja`).
2. Create `locales/<code>/` and copy every JSON file from `locales/en/` as a starting point.
3. Translate the values, **keeping every key unchanged**. Interpolation placeholders like `{{amount}}` and plural forms (`key_one`, `key_other`) must stay.
4. Register the code in `fe/src/services/languageStorage.ts` by appending it to `AVAILABLE_LANGUAGES`.
5. Import the JSON files in `fe/src/i18n.ts` and add them to the `resources` map under the new language key.
6. Run `bash test.sh` to make sure existing tests still pass, then test the UI by selecting the new language in Settings → Preferences → Language.

## Writing guidelines

- Keep keys **semantic** (`placeBid.minBid`), never dependent on English wording.
- Use `{{name}}` interpolation for dynamic values. Never concatenate strings in code.
- Pluralization uses i18next's built-in `_one` / `_other` suffixes plus a `count` argument — don't write `"X" + (n === 1 ? " bid" : " bids")` in components.
- UI strings may contain line breaks or markdown; keep them human, not overly formal.
- Error messages (`errors.json`) are matched by pattern in `services/errorMessages.ts`. Adding new error patterns means adding both a matcher there and a key here.

## When to add a new namespace

Split a namespace when one file grows past ~150 lines or when an area has a distinct audience (e.g. onboarding tour copy vs. regular Settings). Register the new namespace in `NAMESPACES` inside `fe/src/i18n.ts`.
