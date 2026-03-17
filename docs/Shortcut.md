# Ask About Selection Inline Update

This document summarizes the latest inline UX changes for `Vibe: Ask About Selection`.

## Current State

The command now supports two input paths:

- **Proposed inline input** (preferred): shown near the selection in the editor
- **Fallback panel input**: used when Proposed API is unavailable

Shortcut and command entry points:

- Default shortcut:
  - macOS: `cmd+alt+q`
  - Windows/Linux: `ctrl+alt+q`
- Users can customize keybindings directly in VS Code Keyboard Shortcuts for `vibe.askAboutSelection`
- Context menu entry is still available

## What Changed

### Inline Input (Proposed API path)

- ✅ Single-line input (`input[type="text"]`)
- ✅ `Send` button placed on the same row (right side)
- ✅ Fixed inline height (no dynamic resize/rebuild loop)
- ✅ Placeholder updated to `Press Enter to send, Esc to cancel`
- ✅ `Enter` submits, `Esc` cancels
- ✅ Inline error text uses single-line ellipsis to avoid layout growth

### Width Safety Zone

- ✅ Added right-side safe area to avoid minimap/scrollbar overlap
- ✅ Inline shell uses:
  - `--inline-right-safe: 120px`
  - `width/max-width: calc(100% - var(--inline-right-safe))`
  - `margin-right: var(--inline-right-safe)`
- ✅ On very narrow width (`max-width: 520px`), fallback to full width layout to prevent over-compression

### Unchanged Behavior

- ✅ Fallback panel UI/behavior unchanged
- ✅ Ask execution flow unchanged (`threadService.askQuestion` + `controller.openThread`)
- ✅ Public command ID unchanged: `vibe.askAboutSelection`

## Validation

The following checks passed:

- ✅ `pnpm typecheck`
- ✅ `pnpm build:extension`

## Review Conclusion

- **Blocking findings:** none
- **Residual risk:** on very narrow editor widths, safe-zone fallback (`max-width: 520px`) may reduce right-side avoidance effectiveness if minimap remains visible.

## Next Step (Optional)

If we still observe overlap in specific themes/layouts, we can promote `--inline-right-safe` to a configurable setting for environment-specific tuning.
