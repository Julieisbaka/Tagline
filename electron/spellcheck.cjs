function registerSpellcheck({ ipcMain, assertMainFrame }) {
  const checkSender = (event) => assertMainFrame(event, 'Spellcheck');
  const validateWord = (word) => {
    if (typeof word !== 'string' || !word.trim() || word.length > 256) {
      throw new Error('Invalid spelling word.');
    }
    return word;
  };

  ipcMain.handle('spellcheck:listWords', async (event) => {
    checkSender(event);
    return event.sender.session.listWordsInSpellCheckerDictionary();
  });
  ipcMain.handle('spellcheck:addWord', async (event, word) => {
    checkSender(event);
    const validWord = validateWord(word);
    return event.sender.session.addWordToSpellCheckerDictionary(validWord);
  });
  ipcMain.handle('spellcheck:removeWord', async (event, word) => {
    checkSender(event);
    const validWord = validateWord(word);
    return event.sender.session.removeWordFromSpellCheckerDictionary(validWord);
  });
  ipcMain.handle('spellcheck:replace', async (event, suggestion) => {
    checkSender(event);
    const validSuggestion = validateWord(suggestion);
    event.sender.replaceMisspelling(validSuggestion);
  });
}

module.exports = { registerSpellcheck };
