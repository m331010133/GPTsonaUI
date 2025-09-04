
const defaultState = {
  enabled: true,
  bgDataUrl: "",
  bgSize: "cover",
  bgOpacity: 0.25,
  bgBlurPx: 8,
  userAvatar: "",
  assistantAvatar: "",
  userName: "You",
  assistantName: "ChatGPT",
};

let state = { ...defaultState };
let observer = null;
let bgDiv = null;
let chatKey = location.pathname;
let urlWatcher = null;

// ---------- storage ----------
function getState(key = chatKey) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => {
      const stored = res[key] || {};
      resolve({ ...defaultState, ...stored });
    });
  });
}
function setState(patch, key = chatKey) {
  return new Promise((resolve) => {
    state = { ...state, ...patch };
    chrome.storage.local.set({ [key]: state }, () => resolve());
  });
}

// ---------- CSS injection (only once) ----------
function ensureInjectedStyles() {
  if (document.getElementById("ccc-style-all")) return;
  const s = document.createElement("style");
  s.id = "ccc-style-all";
  s.textContent = `
    :root{
      --ccc-bg-size: cover;
      --ccc-bg-position: center center;
      --ccc-bg-opacity: 1;
      --ccc-bg-blur: 0px;
      --ccc-user-avatar: none;
      --ccc-assistant-avatar: none;
    }

    /* Host that holds bg + panel */
    .ccc-host{ position: relative !important; }

    /* Hide default avatars inside message wrappers */
    [data-message-author-role="user"] img,
    [data-message-author-role="user"] svg,
    [data-message-author-role="assistant"] img,
    [data-message-author-role="assistant"] svg { display:none !important; }

    /* Background (bottom-most) */
    #ccc-background-layer{
      position:absolute!important; inset:0!important; z-index:-2!important;
      background-repeat:no-repeat!important;
      background-position:var(--ccc-bg-position)!important;
      background-size:var(--ccc-bg-size)!important;
      opacity:var(--ccc-bg-opacity)!important;
      filter:blur(var(--ccc-bg-blur))!important;
      pointer-events:none!important;
    }

    /* Middle translucent conversation panel (above bg, below content) */
    .ccc-convo-panel{
      position:absolute; top:0; bottom:0; left:50%; transform:translateX(-50%);
      width:clamp(640px, 70%, 980px);
      background:rgba(0,0,0,0.48);
      border-radius:14px;
      z-index:-1!important; pointer-events:none;
    }

    /* Ensure message wrappers can anchor absolute avatar + room above */
    [data-message-author-role="assistant"],
    [data-message-author-role="user"]{
      position:relative !important;
      margin-top:22px !important;
    }

    /* Shared style for all names */
	.ccc-name {
		font-size: 14px;
		font-weight: 600;
		color: #ccc;
		margin-bottom: 5px;
		display: flex;       /* key: flex container */
		width: 100%;         /* take row space, so we can justify */
	}
	
	/* Assistant → stick to left */
	[data-message-author-role="assistant"] .ccc-name {
		justify-content: flex-start;
		padding-left: 0px;  /* offset to clear avatar */
	}
	/* User → stick to right */
	[data-message-author-role="user"] .ccc-name {
		justify-content: flex-end;
		padding-right: 0px; /* offset to clear avatar */
	}

    /* Top-floating avatars (outside message line) */
    .ccc-avatar-top{
      position:absolute!important; top:-5px;
      width:28px; height:28px; border-radius:50%;
      background-size:cover; background-position:center;
      z-index:1;
    }
    [data-message-author-role="assistant"] .ccc-avatar-top{ left:-40px; }
    [data-message-author-role="user"] .ccc-avatar-top{ right:-40px; }

    @media (max-width: 900px){
      [data-message-author-role="assistant"] .ccc-avatar-top{ left:-32px; }
      [data-message-author-role="user"] .ccc-avatar-top{ right:-32px; }
    }
  `;
  document.head.appendChild(s);
}

// ---------- DOM helpers ----------
function findChatScrollContainer() {
  const candidates = Array.from(document.querySelectorAll("main *")).filter((el) => {
    const cs = getComputedStyle(el);
    return (cs.overflowY === "auto" || cs.overflowY === "scroll") && el.clientHeight > 200;
  });
  return candidates[0] || document.querySelector("main") || document.body;
}

// ---------- background + panel ----------
function applyBackground() {
  const container = findChatScrollContainer();
  if (!container) return;

  container.classList.add("ccc-host");

  let bg = container.querySelector("#ccc-background-layer");
  if (!bg) {
    bg = document.createElement("div");
    bg.id = "ccc-background-layer";
    container.insertBefore(bg, container.firstChild);
  }

  bg.style.zIndex = "-2";
  document.documentElement.style.setProperty("--ccc-bg-size", state.bgSize);
  document.documentElement.style.setProperty("--ccc-bg-opacity", String(state.bgOpacity));
  document.documentElement.style.setProperty("--ccc-bg-blur", `${state.bgBlurPx}px`);

  // ✅ Force refresh background
  if (state.enabled && state.bgDataUrl) {
    bg.style.backgroundImage = "none"; // clear first
    void bg.offsetHeight;              // force reflow
    bg.style.backgroundImage = `url("${state.bgDataUrl}")`;
    bg.style.display = "block";
  } else {
    bg.style.backgroundImage = "none";
    bg.style.display = "none";
  }
}


function applyConversationPanel() {
  const container = findChatScrollContainer();
  if (!container) return;

  container.classList.add("ccc-host");
  if (!container.querySelector(".ccc-convo-panel")) {
    const panel = document.createElement("div");
    panel.className = "ccc-convo-panel";
    container.prepend(panel);
  }
}

// ---------- avatars + names ----------
function ensureAvatarElement(wrapper) {
  let slot = wrapper.querySelector(".ccc-avatar-top");
  if (slot) return slot;
  const avatar = document.createElement("div");
  avatar.className = "ccc-avatar-top";
  wrapper.append(avatar); // absolute positioned; order doesn’t matter
  return avatar;
}
function ensureNameElement(wrapper) {
  let el = wrapper.querySelector(".ccc-name");
  if (el) return el;
  el = document.createElement("div");
  el.className = "ccc-name";
  wrapper.prepend(el);
  return el;
}
function applyAvatarsAndNames() {
  if (!state.enabled) return;
  const wrappers = document.querySelectorAll("[data-message-author-role], [data-author-role]");
  wrappers.forEach((w) => {
    const role =
      w.getAttribute("data-message-author-role") ||
      w.getAttribute("data-author-role") || "";

    if (role !== "user" && role !== "assistant") return;

    const isUser = role === "user";
    const avatarEl = ensureAvatarElement(w);
    const nameEl = ensureNameElement(w);

    const url = isUser ? state.userAvatar : state.assistantAvatar;
    const varName = isUser ? "--ccc-user-avatar" : "--ccc-assistant-avatar";
    if (url) {
      document.documentElement.style.setProperty(varName, `url("${url}")`);
      avatarEl.style.backgroundImage = `var(${varName})`;
    } else {
      avatarEl.style.backgroundImage = "none";
    }

    nameEl.textContent = isUser ? (state.userName || "You") : (state.assistantName || "ChatGPT");
  });
}

// ---------- observers / wiring ----------
function startObserver() {
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    applyBackground();
    applyConversationPanel();
    applyAvatarsAndNames();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
function startUrlWatcher() {
  if (urlWatcher) clearInterval(urlWatcher);
  let lastPath = location.pathname;
  urlWatcher = setInterval(async () => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      chatKey = location.pathname;
      state = await getState(chatKey);
      applyBackground();
      applyConversationPanel();
      applyAvatarsAndNames();
    }
  }, 800);
}

// ---------- init ----------
async function init() {
  ensureInjectedStyles();
  state = await getState();
  applyBackground();
  applyConversationPanel();
  applyAvatarsAndNames();
  startObserver();
  startUrlWatcher();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "ccc:update") {
      setState(msg.payload).then(() => {
        applyBackground();
        applyConversationPanel();
        applyAvatarsAndNames();
      });
    }
  });
}
init();
