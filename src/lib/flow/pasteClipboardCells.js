/**
 * Paste the current clipboard text into a flow grid selection.
 *
 * A context-menu paste reads the clipboard through JavaScript rather than a
 * native paste event, so both the read and the parse can fail. Report either
 * failure through `onError` — the same way the native paste handler does —
 * instead of leaving an unhandled rejection in the console.
 */
export async function pasteClipboardCells({
  api,
  navigator: webNavigator,
  paste,
  onError,
  row,
  column,
}) {
  try {
    const text = api?.clipboardRead
      ? await api.clipboardRead()
      : await (webNavigator ?? globalThis.navigator).clipboard.readText();
    paste(text, row, column);
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
  }
}
