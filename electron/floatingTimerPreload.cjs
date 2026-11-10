const { ipcRenderer } = require('electron');

ipcRenderer.on('timer:state', (_event, state) => {
  for (const key of ['label', 'time', 'status']) {
    document.getElementById(key).textContent = state[key];
  }
});
