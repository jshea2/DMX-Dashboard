const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('dmxApp', {
  version: '1.0'
});
