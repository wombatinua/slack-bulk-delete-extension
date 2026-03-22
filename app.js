const els = {
  connectSlack: document.querySelector("#connect-slack"),
  clearToken: document.querySelector("#clear-token"),
  authSummary: document.querySelector("#auth-summary"),
  connectionPill: document.querySelector("#connection-pill"),
  cachePill: document.querySelector("#cache-pill"),
  channelSelect: document.querySelector("#channel-select"),
  onlyParticipated: document.querySelector("#only-participated"),
  participationSummary: document.querySelector("#participation-summary"),
  startDate: document.querySelector("#start-date"),
  endDate: document.querySelector("#end-date"),
  textFilter: document.querySelector("#text-filter"),
  includeThreads: document.querySelector("#include-threads"),
  includeNonText: document.querySelector("#include-non-text"),
  runDelete: document.querySelector("#run-delete"),
  cancelRun: document.querySelector("#cancel-run"),
  metricPhase: document.querySelector("#metric-phase"),
  metricScanned: document.querySelector("#metric-scanned"),
  metricMatched: document.querySelector("#metric-matched"),
  metricDeleted: document.querySelector("#metric-deleted"),
  metricFailed: document.querySelector("#metric-failed"),
  metricThreads: document.querySelector("#metric-threads"),
  runSummary: document.querySelector("#run-summary"),
  log: document.querySelector("#log")
};

const state = {
  token: "",
  auth: null,
  workspaceStates: {},
  channels: [],
  usersById: new Map(),
  participationByChannel: new Map(),
  cleanedByChannel: new Map(),
  activeOperation: "",
  cancelRequested: false,
  activeRequestController: null,
  running: false
};

const methodRateState = new Map();
const METHOD_MIN_INTERVAL_MS = {
  // Official Slack docs currently show:
  // - chat.delete: Tier 3 (50+ per minute)
  // - conversations.history: Tier 3 (50+ per minute) for internal customer-built apps
  // - conversations.replies: Tier 3 (50+ per minute) for internal customer-built apps
  // - conversations.list: Tier 2 (20+ per minute)
  // - users.list: Tier 2 (20+ per minute)
  // - auth.test: hundreds per minute
  //
  // We intentionally stay below those published tiers to reduce the chance of 429s.
  "auth.test": 400,
  "chat.delete": 1500,
  "conversations.history": 1500,
  "conversations.replies": 1500,
  "conversations.list": 3200,
  "users.list": 3200
};

function formatTime24(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatDateTime24(date) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function log(message) {
  const timestamp = formatTime24(new Date());
  els.log.textContent += `[${timestamp}] ${message}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

function clearLog() {
  els.log.textContent = "";
}

function setRunSummary(message) {
  els.runSummary.textContent = message;
}

function updateRunMetrics({
  phase = "Idle",
  scanned = "0",
  matched = "0",
  deleted = "0",
  failed = "0",
  threads = "0/0"
} = {}) {
  els.metricPhase.textContent = phase;
  els.metricScanned.textContent = scanned;
  els.metricMatched.textContent = matched;
  els.metricDeleted.textContent = deleted;
  els.metricFailed.textContent = failed;
  els.metricThreads.textContent = threads;
}

function resetRunMetrics() {
  updateRunMetrics();
}

function updateLiveStatus(phase, overrides = {}) {
  updateRunMetrics({
    phase,
    scanned: overrides.scanned ?? els.metricScanned.textContent,
    matched: overrides.matched ?? els.metricMatched.textContent,
    deleted: overrides.deleted ?? els.metricDeleted.textContent,
    failed: overrides.failed ?? els.metricFailed.textContent,
    threads: overrides.threads ?? els.metricThreads.textContent
  });
}

function formatDateTimeInputDisplay(value) {
  if (!value) {
    return "dd.mm.yyyy hh:mm";
  }

  const [datePart, timePart = ""] = value.split("T");
  const [year = "", month = "", day = ""] = datePart.split("-");
  const [hour = "00", minute = "00"] = timePart.split(":");
  if (!year || !month || !day) {
    return "dd.mm.yyyy hh:mm";
  }

  return `${day}.${month}.${year} ${hour}:${minute}`;
}

function syncDateInputState(input) {
  const shell = input.closest("[data-datetime-shell]");
  const display = shell?.querySelector(".datetime-display");
  if (!shell || !display) {
    return;
  }

  const isEmpty = !input.value;
  shell.classList.toggle("datetime-empty", isEmpty);
  display.textContent = formatDateTimeInputDisplay(input.value);
}

function buildStreamingSummary({
  channelLabel,
  cursor
}) {
  return cursor
    ? `Streaming top-level history in ${channelLabel}. Total remains unknown until Slack finishes pagination.`
    : `Top-level history scan finished for ${channelLabel}.`;
}

function setAuthSummary(message) {
  els.authSummary.textContent = message;
}

function setParticipationSummary(message) {
  els.participationSummary.textContent = message;
}

function setConnectionPill(message, subtle = false) {
  els.connectionPill.textContent = message;
  els.connectionPill.classList.toggle("subtle", subtle);
}

function setCachePill(message, subtle = true) {
  els.cachePill.textContent = message;
  els.cachePill.classList.toggle("subtle", subtle);
}

function setRunning(running, operation = "") {
  state.running = running;
  state.activeOperation = running ? operation : "";
  els.connectSlack.disabled = running;
  els.clearToken.disabled = running;
  els.channelSelect.disabled = running;
  els.onlyParticipated.disabled = running;
  els.startDate.disabled = running;
  els.endDate.disabled = running;
  els.textFilter.disabled = running;
  els.includeThreads.disabled = running;
  els.includeNonText.disabled = running;
  els.runDelete.disabled = running;
  els.cancelRun.disabled = !(running && operation === "delete");
}

function throwIfCancelled() {
  if (state.cancelRequested) {
    throw new Error("Run cancelled.");
  }
}

async function sleep(ms) {
  let remaining = ms;
  while (remaining > 0) {
    throwIfCancelled();
    const slice = Math.min(remaining, 200);
    await new Promise((resolve) => setTimeout(resolve, slice));
    remaining -= slice;
  }
}

function formEncode(params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    body.set(key, String(value));
  }
  return body;
}

function slackTimestampFromInput(value) {
  if (!value) {
    return null;
  }
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    return null;
  }
  return (milliseconds / 1000).toString();
}

function normalizeText(text) {
  return (text ?? "").toLowerCase();
}

function formatProgress(current, total) {
  if (!total) {
    return "0/0";
  }
  return `${current}/${total} (${Math.round((current / total) * 100)}%)`;
}

function findChannelById(channelId) {
  return state.channels.find((channel) => channel.id === channelId) ?? null;
}

function displayChannelLabel(channelId) {
  return findChannelById(channelId)?.label ?? channelId;
}

function currentTeamId() {
  return state.auth?.team_id ?? "";
}

function workspaceSnapshot(teamId) {
  if (!teamId) {
    return null;
  }
  return state.workspaceStates[teamId] ?? null;
}

function applyWorkspaceState(teamId) {
  const snapshot = workspaceSnapshot(teamId);
  state.channels = snapshot?.channels ?? [];
  state.participationByChannel = new Map(
    Object.entries(snapshot?.participationByChannel ?? {})
  );
  state.cleanedByChannel = new Map(
    Object.entries(snapshot?.cleanedByChannel ?? {})
  );
  els.onlyParticipated.checked = Boolean(snapshot?.onlyParticipated);

  renderChannels(snapshot?.lastChannelId ?? "");
  updateParticipationSummary();
}

function recordWorkspaceState(overrides = {}) {
  const teamId = currentTeamId();
  if (!teamId) {
    return;
  }

  const previous = state.workspaceStates[teamId] ?? {};
  state.workspaceStates[teamId] = {
    channels: state.channels,
    participationByChannel: Object.fromEntries(state.participationByChannel),
    cleanedByChannel: Object.fromEntries(state.cleanedByChannel),
    lastChannelId: overrides.lastChannelId ?? previous.lastChannelId ?? "",
    onlyParticipated: overrides.onlyParticipated ?? els.onlyParticipated.checked
  };
}

function messageMatchesFilters(message, authUserId, textFilter, includeNonText) {
  if (!isOwnSupportedMessage(message, authUserId, includeNonText)) {
    return false;
  }

  if (!textFilter) {
    return true;
  }

  return normalizeText(message.text).includes(normalizeText(textFilter));
}

function isOwnSupportedMessage(message, authUserId, includeNonText) {
  if (message.user !== authUserId) {
    return false;
  }

  const subtype = message.subtype ?? "";
  const allowedSubtypes = new Set(["", "me_message"]);
  if (includeNonText) {
    allowedSubtypes.add("file_share");
  }

  return allowedSubtypes.has(subtype);
}

async function slackApi(method, params = {}) {
  if (!state.token) {
    throw new Error("Missing Slack token.");
  }

  const minimumInterval = METHOD_MIN_INTERVAL_MS[method] ?? 0;

  while (true) {
    throwIfCancelled();
    const rateState = methodRateState.get(method);
    const waitMs = Math.max(0, (rateState?.nextAllowedAt ?? 0) - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    throwIfCancelled();

    if (minimumInterval > 0) {
      methodRateState.set(method, {
        nextAllowedAt: Date.now() + minimumInterval
      });
    }

    const controller = new AbortController();
    state.activeRequestController = controller;

    let response;
    try {
      response = await fetch(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.token}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: formEncode(params),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError" && state.cancelRequested) {
        throw new Error("Run cancelled.");
      }
      throw error;
    } finally {
      if (state.activeRequestController === controller) {
        state.activeRequestController = null;
      }
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "1");
      methodRateState.set(method, {
        nextAllowedAt: Date.now() + retryAfter * 1000
      });
      if (state.activeOperation === "delete") {
        updateRunMetrics({
          phase: `Waiting for Slack retry • ${method}`,
          scanned: els.metricScanned.textContent,
          matched: els.metricMatched.textContent,
          deleted: els.metricDeleted.textContent,
          failed: els.metricFailed.textContent,
          threads: els.metricThreads.textContent
        });
      }
      log(`${method} hit rate limit. Waiting ${retryAfter}s.`);
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!response.ok) {
      throw new Error(`${method} HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.ok) {
      const pieces = [data.error ?? "unknown_error"];
      if (data.needed) {
        pieces.push(`needed=${data.needed}`);
      }
      if (data.provided) {
        pieces.push(`provided=${data.provided}`);
      }
      throw new Error(`${method} failed: ${pieces.join(" ")}`);
    }

    return data;
  }
}

async function loadStoredState() {
  let migratedLegacyWorkspaceState = false;
  const stored = await chrome.storage.local.get([
    "token",
    "auth",
    "capturedAt",
    "workspaces",
    "channels",
    "lastChannelId",
    "participationByChannel",
    "cleanedByChannel",
    "onlyParticipated"
  ]);

  state.token = stored.token ?? "";
  state.auth = stored.auth ?? null;
  state.workspaceStates = { ...(stored.workspaces ?? {}) };

  if (
    state.auth?.team_id &&
    !state.workspaceStates[state.auth.team_id] &&
    (stored.channels || stored.participationByChannel || stored.cleanedByChannel || stored.lastChannelId || stored.onlyParticipated !== undefined)
  ) {
    migratedLegacyWorkspaceState = true;
    state.workspaceStates[state.auth.team_id] = {
      channels: stored.channels ?? [],
      participationByChannel: stored.participationByChannel ?? {},
      cleanedByChannel: stored.cleanedByChannel ?? {},
      lastChannelId: stored.lastChannelId ?? "",
      onlyParticipated: Boolean(stored.onlyParticipated)
    };
  }

  applyWorkspaceState(state.auth?.team_id ?? "");

  if (migratedLegacyWorkspaceState) {
    await chrome.storage.local.remove([
      "channels",
      "lastChannelId",
      "participationByChannel",
      "cleanedByChannel",
      "onlyParticipated"
    ]);
    await chrome.storage.local.set({
      workspaces: state.workspaceStates
    });
  }

  if (state.auth) {
    setConnectionPill("Connected");
    setAuthSummary(
      `Verified as ${state.auth.user} (${state.auth.user_id}) on ${state.auth.team}.`
    );
  } else if (stored.token && stored.capturedAt) {
    setConnectionPill("Session captured", true);
    setAuthSummary(
      `Captured a Slack web session token at ${formatDateTime24(new Date(stored.capturedAt))}.`
    );
  } else {
    setConnectionPill("Not connected", true);
    setAuthSummary("Open Slack in Chrome and click Connect Slack.");
  }

  resetRunMetrics();
}

async function persistState(extra = {}) {
  const {
    lastChannelId: _ignoredLastChannelId,
    onlyParticipated: _ignoredOnlyParticipated,
    ...globalExtra
  } = extra;
  recordWorkspaceState(extra);
  await chrome.storage.local.set({
    token: state.token,
    auth: state.auth,
    workspaces: state.workspaceStates,
    ...globalExtra
  });
}

function filteredChannels() {
  if (!els.onlyParticipated.checked) {
    return state.channels;
  }

  return state.channels.filter((channel) => {
    return state.participationByChannel.get(channel.id) === true;
  });
}

function renderChannels(selectedId = "") {
  const select = els.channelSelect;
  select.innerHTML = "";
  const channels = filteredChannels();

  if (!channels.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = state.channels.length
      ? "No conversations match the current filter"
      : "Connect Slack to load conversations";
    select.append(option);
    return;
  }

  for (const channel of channels) {
    const option = document.createElement("option");
    option.value = channel.id;
    option.textContent = formatChannelOptionLabel(channel);
    if (channel.id === selectedId) {
      option.selected = true;
    }
    select.append(option);
  }
}

function formatChannelOptionLabel(channel) {
  if (state.cleanedByChannel.has(channel.id)) {
    return `[Cleaned] ${channel.label}`;
  }
  return channel.label;
}

function updateParticipationSummary() {
  const total = state.channels.length;
  const scannable = state.channels.filter((channel) => channel.scanEligible);
  const scannedScannable = scannable.filter((channel) => {
    return state.participationByChannel.has(channel.id);
  }).length;
  const positive = state.channels.filter((channel) => {
    return state.participationByChannel.get(channel.id) === true;
  }).length;

  if (!total) {
    setParticipationSummary("Participation filter not built yet.");
    setCachePill("No participation cache", true);
    return;
  }

  if (scannable.length === 0) {
    setParticipationSummary("All loaded conversations are direct chats and are included automatically.");
    setCachePill("Participation cached", false);
    return;
  }

  if (!scannedScannable) {
    setParticipationSummary("Enable the participation filter to build a cache for non-DM conversations.");
    setCachePill("No participation cache", true);
    return;
  }

  setParticipationSummary(
    `Participation cached for ${scannedScannable}/${scannable.length} non-DM conversations. Included total: ${positive}/${total}.`
  );
  setCachePill(
    scannedScannable === scannable.length
      ? "Participation cached"
      : `${scannedScannable}/${scannable.length} scanned`,
    scannedScannable !== scannable.length
  );
}

async function loadCapturedToken() {
  updateLiveStatus("Loading captured Slack session", {
    scanned: "-",
    matched: "-",
    deleted: "-",
    failed: "-",
    threads: "-"
  });
  const stored = await chrome.storage.local.get(["token", "capturedAt"]);
  if (!stored.token) {
    throw new Error("No Slack session captured yet. Reload a Slack tab and try again.");
  }

  state.token = stored.token;
  setConnectionPill("Session captured", true);
  setAuthSummary(
    `Loaded captured Slack session from ${stored.capturedAt ? formatDateTime24(new Date(stored.capturedAt)) : "recently"}.`
  );
  log("Loaded token captured from the current Slack browser session.");
}

async function verifyToken() {
  if (!state.token) {
    throw new Error("No Slack session captured yet. Reload a Slack tab and try again.");
  }

  updateLiveStatus("Verifying Slack session", {
    scanned: "-",
    matched: "-",
    deleted: "-",
    failed: "-",
    threads: "-"
  });
  log("Verifying token with auth.test.");
  const previousTeamId = currentTeamId();
  const auth = await slackApi("auth.test");
  state.auth = {
    user: auth.user,
    user_id: auth.user_id,
    team: auth.team,
    team_id: auth.team_id,
    url: auth.url
  };

  if (auth.team_id !== previousTeamId) {
    applyWorkspaceState(auth.team_id);
  }

  setConnectionPill("Connected");
  setAuthSummary(
    `Verified as ${auth.user} (${auth.user_id}) on ${auth.team}.`
  );
  await persistState();
  log(`Verified token for ${auth.user} on ${auth.team}.`);
}

function buildUserLabel(user) {
  const profile = user.profile ?? {};
  const displayName = profile.display_name_normalized || profile.display_name;
  const realName = profile.real_name_normalized || profile.real_name;
  const fallback = user.name || user.id;
  const best = displayName || realName || fallback;
  const detail = profile.email || user.name || user.id;
  return {
    label: detail && detail !== best ? `${best} <${detail}>` : best,
    shortLabel: best
  };
}

async function loadUsersDirectory() {
  const usersById = new Map();
  let cursor = "";
  let pages = 0;

  updateLiveStatus("Loading people directory", {
    scanned: "0",
    matched: "-",
    deleted: "-",
    failed: "-",
    threads: "-"
  });
  log("Loading people directory for DM labels.");

  do {
    throwIfCancelled();
    const response = await slackApi("users.list", {
      cursor,
      limit: 200
    });
    pages += 1;

    for (const member of response.members ?? []) {
      usersById.set(member.id, buildUserLabel(member));
    }

    cursor = response.response_metadata?.next_cursor ?? "";
    updateLiveStatus(`Loading people directory • page ${pages}`, {
      scanned: usersById.size.toLocaleString(),
      matched: "-",
      deleted: "-",
      failed: "-",
      threads: "-"
    });
    log(`People directory page ${pages}: ${usersById.size} profiles loaded so far.`);
  } while (cursor);

  state.usersById = usersById;
  log(`Loaded ${usersById.size} user profiles for DM labels.`);
}

function channelLabel(channel) {
  const type = channel.is_im
    ? "DM"
    : channel.is_mpim
      ? "MPIM"
      : channel.is_private
        ? "Private"
        : "Channel";

  let name = channel.name || channel.id;

  if (channel.is_im) {
    const user = state.usersById.get(channel.user);
    name = user?.label ?? channel.user ?? channel.id;
  } else if (channel.is_mpim && Array.isArray(channel.members) && channel.members.length) {
    const memberNames = channel.members.map((memberId) => {
      return state.usersById.get(memberId)?.shortLabel ?? memberId;
    });
    name = memberNames.join(", ");
  }

  return `${type}: ${name} (${channel.id})`;
}

async function loadChannels() {
  if (!state.auth) {
    await verifyToken();
  }

  try {
    await loadUsersDirectory();
  } catch (error) {
    if (error.message === "Run cancelled.") {
      throw error;
    }
    state.usersById = new Map();
    log(`users.list unavailable, keeping raw DM labels: ${error.message}`);
  }

  log("Loading conversations.");
  updateLiveStatus("Loading conversations", {
    scanned: "0",
    matched: "-",
    deleted: "-",
    failed: "-",
    threads: "-"
  });
  const channels = [];
  let cursor = "";
  let pages = 0;

  do {
    throwIfCancelled();
    const response = await slackApi("conversations.list", {
      exclude_archived: true,
      limit: 200,
      types: "public_channel,private_channel,im,mpim",
      cursor
    });
    pages += 1;

    for (const channel of response.channels ?? []) {
      channels.push({
        id: channel.id,
        label: channelLabel(channel),
        kind: channel.is_im
          ? "dm"
          : channel.is_mpim
            ? "mpim"
            : channel.is_private
              ? "private"
              : "channel",
        scanEligible: !channel.is_im
      });
    }

    cursor = response.response_metadata?.next_cursor ?? "";
    updateLiveStatus(`Loading conversations • page ${pages}`, {
      scanned: channels.length.toLocaleString(),
      matched: "-",
      deleted: "-",
      failed: "-",
      threads: "-"
    });
    log(`Conversation page ${pages}: ${channels.length} conversations loaded so far.`);
  } while (cursor);

  channels.sort((left, right) => left.label.localeCompare(right.label));
  state.channels = channels;
  const preferredChannelId = workspaceSnapshot(currentTeamId())?.lastChannelId ?? "";
  const selectedChannelId = channels.some((channel) => channel.id === preferredChannelId)
    ? preferredChannelId
    : channels[0]?.id ?? "";

  for (const channel of channels) {
    if (!channel.scanEligible) {
      state.participationByChannel.set(channel.id, true);
    }
  }

  renderChannels(selectedChannelId);
  await persistState({ lastChannelId: selectedChannelId });
  setAuthSummary(
    `Verified as ${state.auth.user} (${state.auth.user_id}) on ${state.auth.team}. Loaded ${channels.length} conversations.`
  );
  updateParticipationSummary();
  updateLiveStatus("Conversations loaded", {
    scanned: channels.length.toLocaleString(),
    matched: "-",
    deleted: "-",
    failed: "-",
    threads: "-"
  });
  log(`Loaded ${channels.length} conversations.`);
}

async function listHistoryPage(channel, oldest, latest, cursor = "") {
  const response = await slackApi("conversations.history", {
    channel,
    cursor,
    limit: 200,
    oldest,
    latest
  });

  return {
    messages: response.messages ?? [],
    cursor: response.response_metadata?.next_cursor ?? ""
  };
}

async function listReplies(channel, ts, oldest, latest) {
  const replies = [];
  let cursor = "";

  do {
    throwIfCancelled();
    const response = await slackApi("conversations.replies", {
      channel,
      ts,
      cursor,
      limit: 200,
      oldest,
      latest
    });
    replies.push(...(response.messages ?? []));
    cursor = response.response_metadata?.next_cursor ?? "";
  } while (cursor);

  return replies;
}

async function hasOwnParticipation(channel, oldest = null, latest = null) {
  const authUserId = state.auth?.user_id;
  if (!authUserId) {
    throw new Error("Missing authenticated user context.");
  }

  let cursor = "";

  do {
    throwIfCancelled();
    const response = await slackApi("conversations.history", {
      channel,
      cursor,
      limit: 200,
      oldest,
      latest
    });

    const messages = response.messages ?? [];

    for (const message of messages) {
      if (isOwnSupportedMessage(message, authUserId, true)) {
        return true;
      }
    }

    const threadedRoots = messages.filter((message) => Number(message.reply_count ?? 0) > 0);
    for (const root of threadedRoots) {
      throwIfCancelled();
      const replies = await listReplies(channel, root.ts, oldest, latest);
      for (const reply of replies) {
        throwIfCancelled();
        if (reply.ts === root.ts) {
          continue;
        }
        if (isOwnSupportedMessage(reply, authUserId, true)) {
          return true;
        }
      }
    }

    cursor = response.response_metadata?.next_cursor ?? "";
  } while (cursor);

  return false;
}

async function buildParticipationCache() {
  if (!state.auth) {
    await verifyToken();
  }

  if (!state.channels.length) {
    await loadChannels();
  }

  const scannable = state.channels.filter((channel) => channel.scanEligible);
  const pending = scannable.filter((channel) => !state.participationByChannel.has(channel.id));
  const alreadyCached = scannable.length - pending.length;

  if (!scannable.length) {
    updateParticipationSummary();
    resetRunMetrics();
    return;
  }

  if (!pending.length) {
    setParticipationSummary(
      `Participation cache ready for all ${scannable.length} non-DM conversations.`
    );
    log(`Participation cache already complete for ${scannable.length} non-DM conversations.`);
    updateParticipationSummary();
    renderChannels(els.channelSelect.value);
    resetRunMetrics();
    return;
  }

  log(
    `Building participation cache for ${pending.length} non-DM conversations. ${alreadyCached} already cached.`
  );

  for (let index = 0; index < pending.length; index += 1) {
    throwIfCancelled();
    const channel = pending[index];
    const overallCurrent = alreadyCached + index + 1;
    const pendingProgress = formatProgress(index + 1, pending.length);
    const overallProgress = formatProgress(overallCurrent, scannable.length);

    setParticipationSummary(
      `Scanning ${channel.label} • pending ${pendingProgress} • overall ${overallProgress}`
    );
    updateRunMetrics({
      phase: `Caching participation • ${overallProgress}`,
      scanned: `${overallCurrent}/${scannable.length}`,
      matched: "-",
      deleted: "-",
      failed: "-",
      threads: "-"
    });
    log(
      `Participation scan ${pendingProgress} pending, ${overallProgress} overall: ${channel.label}`
    );
    const participated = await hasOwnParticipation(channel.id);
    state.participationByChannel.set(channel.id, participated);
    await persistState();
    log(
      `${participated ? "Found your messages in" : "No messages from you in"} ${channel.label}`
    );
  }

  updateParticipationSummary();
  renderChannels(els.channelSelect.value);
  resetRunMetrics();
}

async function deleteCandidate(candidate) {
  throwIfCancelled();
  await slackApi("chat.delete", {
    channel: candidate.channel,
    ts: candidate.ts
  });
}

async function handleCandidate(candidate, stats) {
  try {
    stats.matched += 1;
    await deleteCandidate(candidate);
    stats.deleted += 1;
    log(`Deleted ${candidate.ts} ${candidate.source}`);
  } catch (error) {
    if (error.message === "Run cancelled.") {
      throw error;
    }
    stats.failed += 1;
    log(`Failed ${candidate.ts}: ${error.message}`);
  }
}

async function connectSlack() {
  throwIfCancelled();
  await loadCapturedToken();
  await verifyToken();
  await loadChannels();
  if (els.onlyParticipated.checked) {
    await buildParticipationCache();
  }
}

async function runBulkDelete() {
  if (state.running) {
    return;
  }

  clearLog();
  state.cancelRequested = false;
  setRunning(true, "delete");
  resetRunMetrics();

  try {
    if (!state.auth) {
      await connectSlack();
    }

    const channel = els.channelSelect.value;
    if (!channel) {
      throw new Error("Select a conversation first.");
    }

    const oldest = slackTimestampFromInput(els.startDate.value);
    const latest = slackTimestampFromInput(els.endDate.value);
    const includeThreads = els.includeThreads.checked;
    const includeNonText = els.includeNonText.checked;
    const textFilter = els.textFilter.value.trim();
    const authUserId = state.auth.user_id;
    const channelLabel = displayChannelLabel(channel);
    const qualifiesForCleanMarker =
      !oldest && !latest && !textFilter && includeThreads && includeNonText;

    await persistState({ lastChannelId: channel });

    const stats = {
      deleted: 0,
      failed: 0,
      historyPages: 0,
      topLevelFetched: 0,
      threadRootsQueued: 0,
      threadRootsProcessed: 0,
      matched: 0
    };

    const threadRoots = [];
    let cursor = "";
    const renderDeleteMetrics = (phase) => {
      updateRunMetrics({
        phase,
        scanned: stats.topLevelFetched.toLocaleString(),
        matched: stats.matched.toLocaleString(),
        deleted: stats.deleted.toLocaleString(),
        failed: stats.failed.toLocaleString(),
        threads: stats.threadRootsQueued
          ? `${stats.threadRootsProcessed}/${stats.threadRootsQueued}`
          : "0/0"
      });
    };
    const syncStreamingSummary = () => {
      setRunSummary(
        buildStreamingSummary({
          channelLabel,
          cursor
        })
      );
    };

    setRunSummary(`Preparing cleanup for ${channelLabel}.`);
    renderDeleteMetrics("Top-level scan • page 0");
    log(`Starting cleanup for ${channelLabel}.`);
    log(
      `Run options: ${includeThreads ? "with" : "without"} thread replies, ${includeNonText ? "with" : "without"} files/screenshots${textFilter ? `, text contains "${textFilter}"` : ""}${oldest || latest ? ", date range applied" : ", full history"}.`
    );
    log("Top-level history is scanned page by page. Total top-level count is unknown until Slack stops returning more pages.");

    do {
      throwIfCancelled();
      const pageMatchedBefore = stats.matched;
      const pageDeletedBefore = stats.deleted;
      const pageFailedBefore = stats.failed;
      const page = await listHistoryPage(channel, oldest, latest, cursor);
      cursor = page.cursor;
      stats.historyPages += 1;
      stats.topLevelFetched += page.messages.length;
      log(
        `History page ${stats.historyPages}: fetched ${page.messages.length} top-level messages. ${cursor ? "More history pages remain." : "This is the last top-level history page."}`
      );
      renderDeleteMetrics(`Top-level scan • page ${stats.historyPages}`);
      syncStreamingSummary();

      for (const message of page.messages) {
        throwIfCancelled();
        const hasReplies = includeThreads && Number(message.reply_count ?? 0) > 0;

        if (hasReplies) {
          threadRoots.push(message);
          stats.threadRootsQueued += 1;
        }

        if (hasReplies) {
          continue;
        }

        if (!messageMatchesFilters(message, authUserId, textFilter, includeNonText)) {
          continue;
        }

        renderDeleteMetrics(`Deleting top-level match • page ${stats.historyPages}`);
        await handleCandidate(
          {
            channel,
            ts: message.ts,
            text: message.text ?? "",
            source: "history"
          },
          stats
        );
        renderDeleteMetrics(`Top-level scan • page ${stats.historyPages}`);
        syncStreamingSummary();
      }

      const pageMatched = stats.matched - pageMatchedBefore;
      const pageDeleted = stats.deleted - pageDeletedBefore;
      const pageFailed = stats.failed - pageFailedBefore;
      log(
        `History page ${stats.historyPages} complete: matched ${pageMatched}, deleted ${pageDeleted}, failed ${pageFailed}, scanned so far ${stats.topLevelFetched} top-level messages, queued ${stats.threadRootsQueued} threaded roots.`
      );
      syncStreamingSummary();
      renderDeleteMetrics(
        cursor
          ? `Top-level scan • page ${stats.historyPages}`
          : "Top-level scan complete"
      );
    } while (cursor);

    if (includeThreads && threadRoots.length) {
      setRunSummary(`Processing threaded replies in ${channelLabel}.`);
      renderDeleteMetrics(`Thread scan • 0/${threadRoots.length}`);
      log(`Top-level scan complete. Processing ${threadRoots.length} threaded roots in ${channelLabel}.`);

      for (let index = 0; index < threadRoots.length; index += 1) {
        throwIfCancelled();
        const root = threadRoots[index];
        const threadProgress = formatProgress(index + 1, threadRoots.length);
        log(`Thread scan ${threadProgress}: root ${root.ts}`);
        renderDeleteMetrics(`Scanning thread replies • ${index + 1}/${threadRoots.length}`);

        if (messageMatchesFilters(root, authUserId, textFilter, includeNonText)) {
          renderDeleteMetrics(`Deleting thread root • ${index + 1}/${threadRoots.length}`);
          await handleCandidate(
            {
              channel,
              ts: root.ts,
              text: root.text ?? "",
              source: "thread-root"
            },
            stats
          );
          renderDeleteMetrics(`Scanning thread replies • ${index + 1}/${threadRoots.length}`);
        }

        const replies = await listReplies(channel, root.ts, oldest, latest);
        for (const reply of replies) {
          throwIfCancelled();
          if (reply.ts === root.ts) {
            continue;
          }

          if (!messageMatchesFilters(reply, authUserId, textFilter, includeNonText)) {
            continue;
          }

          renderDeleteMetrics(`Deleting thread reply • ${index + 1}/${threadRoots.length}`);
          await handleCandidate(
            {
              channel,
              ts: reply.ts,
              text: reply.text ?? "",
              source: "thread"
            },
            stats
          );
          renderDeleteMetrics(`Scanning thread replies • ${index + 1}/${threadRoots.length}`);
        }

        stats.threadRootsProcessed += 1;
        setRunSummary(`Processing threaded replies in ${channelLabel}.`);
        renderDeleteMetrics(`Thread scan • ${stats.threadRootsProcessed}/${stats.threadRootsQueued}`);
      }
    } else if (includeThreads) {
      log(`No threaded roots found in ${channelLabel}.`);
      setRunSummary(`No threaded replies found in ${channelLabel}.`);
      renderDeleteMetrics("No threaded roots found");
    }

    setRunSummary(`Cleanup finished for ${channelLabel}.`);
    renderDeleteMetrics("Completed");

    if (qualifiesForCleanMarker && stats.failed === 0) {
      state.cleanedByChannel.set(channel, String(Date.now()));
      await persistState();
      renderChannels(channel);
      log("Marked conversation as cleaned.");
    }
  } catch (error) {
    if (error.message === "Run cancelled.") {
      setRunSummary("Cancellation complete.");
      updateRunMetrics({
        phase: "Cancelled",
        scanned: els.metricScanned.textContent,
        matched: els.metricMatched.textContent,
        deleted: els.metricDeleted.textContent,
        failed: els.metricFailed.textContent,
        threads: els.metricThreads.textContent
      });
      log("Operation cancelled by user.");
      return;
    }
    throw error;
  } finally {
    state.cancelRequested = false;
    state.activeRequestController = null;
    setRunning(false);
  }
}

els.connectSlack.addEventListener("click", async () => {
  try {
    setRunning(true, "connect");
    await connectSlack();
  } catch (error) {
    setAuthSummary(error.message);
    log(error.message);
  } finally {
    setRunning(false);
  }
});

els.clearToken.addEventListener("click", async () => {
  state.token = "";
  state.auth = null;
  state.workspaceStates = {};
  state.channels = [];
  state.participationByChannel = new Map();
  state.cleanedByChannel = new Map();
  els.startDate.value = "";
  els.endDate.value = "";
  els.textFilter.value = "";
  els.includeThreads.checked = true;
  els.includeNonText.checked = false;
  els.onlyParticipated.checked = false;
  syncDateInputState(els.startDate);
  syncDateInputState(els.endDate);
  setConnectionPill("Not connected", true);
  setAuthSummary("Reset complete. Open Slack and connect again when needed.");
  setRunSummary("Idle.");
  resetRunMetrics();
  updateParticipationSummary();
  renderChannels("");
  await chrome.storage.local.remove([
    "token",
    "auth",
    "workspaces",
    "channels",
    "lastChannelId",
    "capturedAt",
    "participationByChannel",
    "cleanedByChannel",
    "onlyParticipated"
  ]);
});

els.cancelRun.addEventListener("click", () => {
  if (!state.running || state.activeOperation !== "delete" || state.cancelRequested) {
    return;
  }

  state.cancelRequested = true;
  if (state.activeRequestController) {
    state.activeRequestController.abort();
  }

  setRunSummary("Cancelling after the current request...");
  updateRunMetrics({
    phase: "Cancelling...",
    scanned: els.metricScanned.textContent,
    matched: els.metricMatched.textContent,
    deleted: els.metricDeleted.textContent,
    failed: els.metricFailed.textContent,
    threads: els.metricThreads.textContent
  });
  log("Cancellation requested.");
});

els.onlyParticipated.addEventListener("change", async () => {
  try {
    if (els.onlyParticipated.checked) {
      setRunning(true, "cache");
      await buildParticipationCache();
    }
  } catch (error) {
    els.onlyParticipated.checked = false;
    setParticipationSummary(`Participation scan failed: ${error.message}`);
    log(`Participation scan failed: ${error.message}`);
  } finally {
    await persistState({
      onlyParticipated: els.onlyParticipated.checked,
      lastChannelId: els.channelSelect.value
    });
    renderChannels(els.channelSelect.value);
    setRunning(false);
  }
});

els.runDelete.addEventListener("click", async () => {
  try {
    await runBulkDelete();
  } catch (error) {
    setRunSummary(`Run failed: ${error.message}`);
    log(`Run failed: ${error.message}`);
    setRunning(false);
  }
});

loadStoredState().catch((error) => {
  setAuthSummary(`Failed to load saved state: ${error.message}`);
});

[els.startDate, els.endDate].forEach((input) => {
  syncDateInputState(input);
  input.addEventListener("input", () => {
    syncDateInputState(input);
  });
  input.addEventListener("change", () => {
    syncDateInputState(input);
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.token?.newValue) {
    return;
  }

  state.token = changes.token.newValue;
  if (!state.running && !state.auth) {
    const capturedAt = changes.capturedAt?.newValue;
    setConnectionPill("Session captured", true);
    if (capturedAt) {
      setAuthSummary(
        `Captured a Slack web session token at ${formatDateTime24(new Date(capturedAt))}.`
      );
    }
  }
});
