export function createExtensionQuickFixRegistry() {
  const tokens = new Map();
  return {
    update(extensionId, diagnostics) {
      for (const [token, item] of tokens) {
        if (item.extensionId === extensionId) {
          tokens.delete(token);
        }
      }
      return diagnostics.map((diagnostic) => {
        if (!diagnostic.quickFix) {
          return diagnostic;
        }
        const token = globalThis.crypto.randomUUID();
        tokens.set(token, { extensionId, command: diagnostic.quickFix.command });
        return { ...diagnostic, quickFix: { ...diagnostic.quickFix, token } };
      });
    },
    matches(token, extensionId, command) {
      const item = tokens.get(token);
      return item?.extensionId === extensionId && item.command === command;
    },
    clear() {
      tokens.clear();
    },
  };
}
