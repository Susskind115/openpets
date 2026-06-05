import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from "electron";
import { info, debug } from "./logger.js";
import { cloudBrainSendEvent } from "./cloud-brain/cloud-brain-client.js";

let chatWindow: BrowserWindow | null = null;
let chatReplyListener: ((message: string, reaction?: string) => void) | null = null;

export function openChatWindow(): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
    return;
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) ?? screen.getPrimaryDisplay();
  const width = 360;
  const height = 440;

  chatWindow = new BrowserWindow({
    title: "Chat",
    width,
    height,
    x: Math.round(display.workArea.x + display.workArea.width - width - 20),
    y: Math.round(display.workArea.y + display.workArea.height - height - 80),
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    frame: false,
    transparent: false,
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: `${app.getAppPath()}/chat-preload.cjs`,
    },
  });

  chatWindow.setMenu(null);
  chatWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  chatWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  chatWindow.once("ready-to-show", () => chatWindow?.show());
  chatWindow.on("closed", () => { chatWindow = null; });

  const html = buildChatHtml();
  chatWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  info("chat", "window opened");
}

export function closeChatWindow(): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.close();
    chatWindow = null;
  }
}

export function sendReplyToChat(message: string, reaction?: string): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send("openpets:chat-reply", { message, reaction });
  }
}

export function installChatHandlers(): void {
  ipcMain.handle("openpets:chat-send", (_event: IpcMainInvokeEvent, text: unknown) => {
    if (typeof text !== "string" || text.trim().length === 0) return { ok: false };
    const trimmed = text.trim().slice(0, 200);
    info("chat", "user message", { length: trimmed.length });
    cloudBrainSendEvent("user.message", { text: trimmed });
    return { ok: true };
  });

  ipcMain.on("openpets:chat-close", () => closeChatWindow());
}

function buildChatHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font:13px/1.5 system-ui,sans-serif; background:#fff; height:100vh; display:flex; flex-direction:column; border-radius:12px; overflow:hidden; }
.titlebar { height:36px; background:linear-gradient(135deg,#667eea 0%,#764ba2 100%); display:flex; align-items:center; padding:0 12px; -webkit-app-region:drag; flex-shrink:0; }
.titlebar span { color:#fff; font-size:13px; font-weight:600; }
.titlebar .close { -webkit-app-region:no-drag; background:none; border:none; color:rgba(255,255,255,0.8); font-size:18px; cursor:pointer; margin-left:auto; padding:0 6px; }
.titlebar .close:hover { color:#fff; }
.messages { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:8px; }
.msg { max-width:80%; padding:8px 12px; border-radius:12px; word-break:break-word; font-size:13px; }
.msg.user { align-self:flex-end; background:#3b82f6; color:#fff; border-bottom-right-radius:4px; }
.msg.pet { align-self:flex-start; background:#f1f5f9; color:#1e293b; border-bottom-left-radius:4px; }
.msg.pet .reaction { font-size:11px; color:#64748b; margin-top:2px; }
.msg.system { align-self:center; color:#94a3b8; font-size:11px; }
.input-area { display:flex; padding:8px 12px; border-top:1px solid #e2e8f0; gap:8px; flex-shrink:0; }
.input-area input { flex:1; border:1px solid #cbd5e1; border-radius:20px; padding:8px 14px; font:inherit; outline:none; }
.input-area input:focus { border-color:#3b82f6; }
.input-area button { background:#3b82f6; color:#fff; border:none; border-radius:20px; padding:8px 16px; font:inherit; font-weight:600; cursor:pointer; }
.input-area button:hover { background:#2563eb; }
.input-area button:disabled { background:#94a3b8; cursor:not-allowed; }
.typing { align-self:flex-start; color:#94a3b8; font-size:12px; padding:4px 12px; display:none; }
.typing.show { display:block; }
</style>
</head><body>
<div class="titlebar"><span>Chat with Pet</span><button class="close" onclick="openPetsChat.close()">×</button></div>
<div class="messages" id="msgs"><div class="msg system">双击宠物打开了聊天窗口，说点什么吧~</div></div>
<div class="typing" id="typing">宠物正在思考...</div>
<div class="input-area">
<input id="input" type="text" placeholder="说点什么..." maxlength="200" autocomplete="off">
<button id="send">发送</button>
</div>
<script>
const msgs = document.getElementById('msgs');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const typing = document.getElementById('typing');

function addMsg(text, cls, extra) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = text;
  if (extra) { const r = document.createElement('div'); r.className='reaction'; r.textContent=extra; div.append(r); }
  msgs.append(div);
  msgs.scrollTop = msgs.scrollHeight;
}

async function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMsg(text, 'user');
  sendBtn.disabled = true;
  typing.classList.add('show');
  await openPetsChat.sendMessage(text);
}

sendBtn.onclick = send;
input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
document.onkeydown = (e) => { if (e.key === 'Escape') openPetsChat.close(); };

openPetsChat.onReply((data) => {
  typing.classList.remove('show');
  sendBtn.disabled = false;
  const reaction = data.reaction ? '(' + data.reaction + ')' : '';
  addMsg(data.message, 'pet', reaction);
});

input.focus();
</script>
</body></html>`;
}
