function parseTokenFromBody(details) {
  const formToken = details.requestBody?.formData?.token?.[0];
  if (formToken) {
    return formToken;
  }

  const raw = details.requestBody?.raw?.[0]?.bytes;
  if (!raw) {
    return null;
  }

  try {
    const decoded = new TextDecoder().decode(raw);
    const params = new URLSearchParams(decoded);
    return params.get("token");
  } catch {
    return null;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

async function persistCapturedToken(token) {
  if (!token || !token.startsWith("xox")) {
    return;
  }

  const current = await chrome.storage.local.get(["token"]);
  if (current.token === token) {
    return;
  }

  await chrome.storage.local.set({
    token,
    capturedAt: Date.now()
  });
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const token = parseTokenFromBody(details);
    if (!token) {
      return;
    }

    persistCapturedToken(token).catch(() => {});
  },
  {
    urls: ["https://*.slack.com/api/*"]
  },
  ["requestBody"]
);
