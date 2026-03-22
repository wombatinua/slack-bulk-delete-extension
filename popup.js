const statusEl = document.querySelector("#popup-status");
const openButton = document.querySelector("#open-app");

async function loadPopupState() {
  const stored = await chrome.storage.local.get(["auth"]);
  const auth = stored.auth;

  if (!auth) {
    statusEl.textContent = "No token verified yet.";
    return;
  }

  const team = auth.team ?? auth.team_id ?? "workspace";
  const user = auth.user ?? auth.user_id ?? "user";
  statusEl.textContent = `Verified for ${user} on ${team}.`;
}

openButton.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
});

loadPopupState().catch((error) => {
  statusEl.textContent = `State load failed: ${error.message}`;
});
