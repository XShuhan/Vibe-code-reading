# Configuration Review (Final Effective State)

This document records the **effective** configuration behavior after the current round of changes.
Only valid, non-duplicated behavior is kept here.

## 1) Model Configuration (vibe.model.*)

The extension uses the existing model settings only:

- `vibe.model.provider`
- `vibe.model.baseUrl`
- `vibe.model.apiKey`
- `vibe.model.model`
- `vibe.model.temperature`
- `vibe.model.maxTokens`

No new model setting keys were introduced.

## 2) Readiness Reminder Behavior

Thread model readiness now has two reminder entry points:

- Startup reminder (once per extension session, workspace mode):
  - Checks thread-model readiness during activation.
  - If not ready, shows a warning with action `Open Vibe Settings`.
  - Action opens Settings UI filtered by `vibe.model`.

- AskAboutSelection submit reminder:
  - Runs the same readiness check before question execution.
  - If not ready, shows the same warning and settings jump action.

Readiness rule used for reminder:

- `provider = mock` -> treated as not ready for reminder.
- `provider = openai-compatible` -> `baseUrl`, `apiKey`, `model` must be non-empty.

## 3) Runtime Semantics

Reminder behavior is non-blocking by design:

- Reminder does not hard-block command invocation by itself.
- Existing runtime validation remains in place for actual model calls.

## 4) AskAboutSelection Shortcut (Final)

Only one built-in shortcut configuration is effective:

- Windows/Linux: `ctrl+alt+q`
- macOS: `cmd+alt+q`
- Command: `vibe.askAboutSelection`
- Condition: `editorTextFocus && editorHasSelection`

Customization path:

- Change keybinding directly in VS Code Keyboard Shortcuts for `vibe.askAboutSelection`.

No extension setting is used for shortcut toggling in final state.
