const assert = require('node:assert/strict');
const { waitFor } = require('../helpers/wait.cjs');

// Regression coverage for a deferred settings dialog whose JavaScript fails to load.
module.exports = async function verifyDeferredDialog(win) {
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code);
  const wait = (condition, message) => waitFor(condition, { timeout: 5000, interval: 10, message });
  let release;
  wc.session.webRequest.onBeforeRequest(({ url }, callback) => {
    if (/\/Dialogs-[^/]+\.js$/.test(url)) {
      release = callback;
    } else {
      callback({});
    }
  });
  try {
    const open = () =>
      js(
        "document.querySelector('.ribbon-settings-button').focus(); document.querySelector('.ribbon-settings-button').click()"
      );
    await open();
    await wait(() => !!release, 'Settings dialog chunk was not requested');
    assert.equal(await js("!!document.querySelector('.deferred-dialog [role=status]')"), true);
    assert.equal(await js("!!document.querySelector('.ribbon').closest('[inert]')"), true);
    assert.equal(await js("!!document.activeElement.closest('.deferred-dialog')"), true);
    release({ cancel: true });
    await wait(
      () => js("!!document.querySelector('.deferred-dialog [role=alert]')"),
      'Dialog load error did not appear'
    );
    assert.match(
      await js("document.querySelector('.deferred-dialog [role=alert]').textContent"),
      /Could not load/
    );
    wc.session.webRequest.onBeforeRequest(null);
    const reloaded = new Promise((resolve) => wc.once('did-finish-load', resolve));
    await js(
      "[...document.querySelectorAll('.deferred-dialog button')].find(button => button.textContent === 'Reload').click()"
    );
    await reloaded;
    await wait(
      () => js("!!document.querySelector('.ribbon-settings-button')"),
      'Settings button did not return after reload'
    );
    await open();
    await wait(
      () => js("!!document.querySelector('.settings')"),
      'Settings did not open after reload'
    );
    await js("document.querySelector('.settings-footer .primary').click()");
    await wait(
      () => js("document.activeElement.matches('.ribbon-settings-button')"),
      'Focus was not restored to the settings button'
    );
    assert.equal(await js("document.querySelectorAll('[inert]').length"), 0);
  } finally {
    wc.session.webRequest.onBeforeRequest(null);
  }
};
