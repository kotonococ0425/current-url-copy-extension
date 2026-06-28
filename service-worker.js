const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "copy-current-url") return;

  const tab = await getActiveTab();
  if (!tab?.url) return;

  await copyCurrentUrl(tab);
});

chrome.action.onClicked.addListener(async (tab) => {
  const targetTab = tab?.url ? tab : await getActiveTab();
  if (!targetTab?.url) return;

  await copyCurrentUrl(targetTab);
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab;
}

async function copyCurrentUrl(tab) {
  try {
    await copyText(tab.url, tab.id);
    await showToast(tab.id, "URLをコピーしました");
    await showBadge(tab.id, "OK", "#1f8f4d");
  } catch (error) {
    console.error("Current URL Copier failed:", error);
    await showBadge(tab.id, "ERR", "#b42318");
  }
}

async function copyText(text, tabId) {
  let offscreenError;

  try {
    await ensureOffscreenDocument();

    const response = await chrome.runtime.sendMessage({
      type: "copy-to-clipboard",
      text
    });

    if (response?.ok) return;
    offscreenError = new Error(response?.error || "Offscreen clipboard copy failed.");
  } catch (error) {
    offscreenError = error;
  }

  try {
    await copyTextInActiveTab(text, tabId);
  } catch (activeTabError) {
    throw new Error(
      `Clipboard copy failed. offscreen=${offscreenError?.message}; activeTab=${activeTabError.message}`
    );
  }
}

async function copyTextInActiveTab(text, tabId) {
  if (!tabId) {
    throw new Error("No active tab is available for clipboard fallback.");
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [text],
    func: async (value) => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }

      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.width = "1px";
      textarea.style.height = "1px";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.focus();
      textarea.select();

      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    }
  });

  if (!result?.result) {
    throw new Error("Failed to copy text with both clipboard paths.");
  }
}

async function showToast(tabId, message) {
  if (!tabId) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [message],
      func: (toastMessage) => {
        const existingToast = document.getElementById("current-url-copier-toast");
        existingToast?.remove();

        const toast = document.createElement("div");
        toast.id = "current-url-copier-toast";
        toast.textContent = toastMessage;
        toast.setAttribute("role", "status");
        Object.assign(toast.style, {
          position: "fixed",
          top: "16px",
          left: "50%",
          zIndex: "2147483647",
          padding: "10px 14px",
          borderRadius: "8px",
          background: "#202124",
          color: "#ffffff",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.24)",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: "14px",
          fontWeight: "600",
          lineHeight: "1.4",
          opacity: "0",
          pointerEvents: "none",
          transform: "translate(-50%, -8px)",
          transition: "opacity 160ms ease, transform 160ms ease"
        });

        document.documentElement.append(toast);
        requestAnimationFrame(() => {
          toast.style.opacity = "1";
          toast.style.transform = "translate(-50%, 0)";
        });

        setTimeout(() => {
          toast.style.opacity = "0";
          toast.style.transform = "translate(-50%, -8px)";
          setTimeout(() => toast.remove(), 180);
        }, 1400);
      }
    });
  } catch (error) {
    console.debug("Current URL Copier toast was not shown:", error);
  }
}

async function ensureOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) return;
  } else if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) {
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["CLIPBOARD"],
      justification: "Copy the current tab URL when the extension command is used."
    });
  } catch (error) {
    if (!error.message.includes("Only a single offscreen document")) {
      throw error;
    }
  }
}

async function showBadge(tabId, text, color) {
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color });

  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" });
  }, 1200);
}
