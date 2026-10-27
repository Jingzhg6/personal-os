# 0015 — UI is Simplified Chinese only

Supersedes the multi-language part of 0003.

**Decision.** The app ships one UI language, `zh-CN`. The English and French catalogues, the
language setting and the `NEXT_LOCALE` cookie are removed; the request config always serves
`zh-CN`.

**Kept.** The infrastructure stays: next-intl, `messages/zh-CN/<namespace>.json`, typed keys,
the `no-literal-string` lint rule, `pnpm i18n:check`, and the stable-identifier rule (labels never
reach the database). `user_settings.locale` remains (always `zh-CN`) so a language can be added
back by restoring a catalogue directory and the setting, without touching modules.

**Why.** The owner uses the app in Chinese only. Keeping two partial translations in step with
every milestone cost time and produced half-translated screens.
