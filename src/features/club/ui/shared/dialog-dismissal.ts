interface DialogEscapeEvent {
  key: string
  defaultPrevented: boolean
  repeat: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

interface DialogBoundary { querySelector: (selector: string) => unknown }
function hasOpenDescendantPopover(dialog: DialogBoundary) {
  try { return Boolean(dialog.querySelector(':popover-open')) }
  catch { return false } // Browsers without the Popover selector have no native child to dismiss.
}

/** Cancel the keyboard default before native CloseWatcher can close the dialog.
 * Its second cancel event may be noncancelable. Child controls get first refusal
 * through bubbling; a held Escape key must not cycle a discard confirmation.
 */
export function handleDialogEscape(event: DialogEscapeEvent, dismissible: boolean, close: () => void, dialog?: DialogBoundary) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  // Native auto popovers have their own close watcher and must consume the
  // first Escape. Limit this check to descendants of this dialog.
  if (dialog && hasOpenDescendantPopover(dialog)) return
  event.preventDefault()
  event.stopPropagation()
  if (dismissible && !event.repeat) close()
}
