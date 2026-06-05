const { contextBridge, ipcRenderer } = require("electron");

const api = {
  sendMessage: (text) => ipcRenderer.invoke("openpets:chat-send", text),
  onReply: (callback) => {
    const listener = (_event, msg) => callback(msg);
    ipcRenderer.on("openpets:chat-reply", listener);
    return () => ipcRenderer.removeListener("openpets:chat-reply", listener);
  },
  close: () => ipcRenderer.send("openpets:chat-close"),
};

contextBridge.exposeInMainWorld("openPetsChat", api);
