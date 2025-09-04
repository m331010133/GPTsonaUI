const defaultState = {
  enabled: true,
  bgDataUrl: "",
  bgSize: "cover",
  bgOpacity: 0.25,
  bgBlurPx: 8,
  userAvatar: "",
  assistantAvatar: "",
  userName: "You",
  assistantName: "AI",
};

let chatKey = null;
let pendingState = { ...defaultState }; // local edits

// ---------- storage ----------
function getState() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url) return resolve(defaultState);
      try {
        const url = new URL(tab.url);
        chatKey = url.pathname;
      } catch {
        chatKey = "global";
      }
      chrome.storage.local.get([chatKey], (res) => {
        const stored = res[chatKey] || {};
        resolve({ ...defaultState, ...stored });
      });
    });
  });
}

function saveState() {
  return new Promise((resolve) => {
    if (!chatKey) return resolve();
    chrome.storage.local.set({ [chatKey]: pendingState }, () => resolve());
  });
}

function sendUpdate() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "ccc:update", payload: pendingState });
  });
}

// ---------- utils ----------
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- init ----------
async function init() {
  const s = await getState();
  pendingState = { ...s };

  const enabled = document.getElementById("enabled");
  const bgFile = document.getElementById("bgFile");
  const bgSize = document.getElementById("bgSize");
  const bgOpacity = document.getElementById("bgOpacity");
  const bgBlur = document.getElementById("bgBlur");
  const bgPreview = document.getElementById("bgPreview");
  const userFile = document.getElementById("userFile");
  const assistantFile = document.getElementById("assistantFile");
  const userName = document.getElementById("userName");
  const assistantName = document.getElementById("assistantName");
  const saveBtn = document.getElementById("saveBtn");
  const resetBtn = document.getElementById("resetBtn");

  // restore UI
  bgSize.value = s.bgSize;
  bgOpacity.value = s.bgOpacity;
  bgBlur.value = s.bgBlurPx;
  if (s.bgDataUrl) bgPreview.style.backgroundImage = `url("${s.bgDataUrl}")`;
  userName.value = s.userName || "";
  assistantName.value = s.assistantName || "";

  bgFile.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await readFileAsDataURL(file);
    bgPreview.style.backgroundImage = `url("${data}")`;
    pendingState.bgDataUrl = data;
  });

  userFile.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await readFileAsDataURL(file);
    pendingState.userAvatar = data;
  });

  assistantFile.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await readFileAsDataURL(file);
    pendingState.assistantAvatar = data;
  });

  bgSize.addEventListener("change", () => {
    pendingState.bgSize = bgSize.value;
  });

  bgOpacity.addEventListener("input", () => {
    pendingState.bgOpacity = parseFloat(bgOpacity.value);
  });

  bgBlur.addEventListener("input", () => {
    pendingState.bgBlurPx = parseInt(bgBlur.value, 10);
  });

  userName.addEventListener("input", () => {
    pendingState.userName = userName.value;
  });

  assistantName.addEventListener("input", () => {
    pendingState.assistantName = assistantName.value;
  });

  saveBtn.addEventListener("click", async () => {
    await saveState();
    sendUpdate();
    window.close();
  });

  resetBtn.addEventListener("click", () => {
    pendingState = { ...defaultState };

    bgSize.value = defaultState.bgSize;
    bgOpacity.value = defaultState.bgOpacity;
    bgBlur.value = defaultState.bgBlurPx;
    bgPreview.style.backgroundImage = "none";
    document.getElementById("bgFile").value = "";
    document.getElementById("userFile").value = "";
    document.getElementById("assistantFile").value = "";
    userName.value = defaultState.userName;
    assistantName.value = defaultState.assistantName;
  });
}

init();
