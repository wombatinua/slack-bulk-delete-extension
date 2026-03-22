# Slack Bulk Delete

Bulk-delete your own Slack messages from the Slack web app, directly from Chrome.

This extension is meant for personal cleanup inside workspaces where you are already signed in to Slack in Chrome. It works as a side panel, scans conversations from your current Slack session, and deletes only messages authored by your account.

## Release Notes

### v0.1.1

- added side-panel polish and compact Slack-like UI
- added live progress metrics, cancellation, and clearer activity logging
- optimized loading so conversations can appear before DM labels finish resolving
- added per-workspace cache separation for conversations, participation, and cleaned markers
- added support for deleting file and screenshot posts
- added `Start from earliest message` as an alternative to a specific start date/time
- added extension icons and release packaging polish

## What This Project Does

- captures your current Slack web session token locally from your browser
- talks directly to Slack Web API endpoints
- loads channels, private channels, DMs, and multi-person chats available to your current session
- filters to your own messages only
- can optionally include thread replies
- can optionally include file and screenshot posts
- supports date range and substring filtering
- shows live progress while scanning and deleting
- lets you cancel an active cleanup run

## Privacy And Safety

This project does not use any vendor backend, proxy, license server, or third-party deletion API.

Your Slack token handling is intentionally simple:

- the token is captured locally from your own Slack browser session
- it is stored in `chrome.storage.local` inside your Chrome profile on this device
- it is used only for direct requests to `https://slack.com/api/*`
- it is not sent to any external service other than Slack itself

In plain terms: this extension does not forward your token to any non-Slack service.

## Important Limitations

- It only deletes messages authored by the currently authenticated Slack user.
- It does not delete other users' messages.
- It does not impersonate admins.
- It does not use Slack admin powers.
- Deletion is permanent.
- Slack rate limits still apply, so large cleanups can take time.

## Quick Start

1. Open Slack in Chrome and make sure you are already signed in.
2. Reload one Slack tab once so the extension can observe your outgoing Slack API token.
3. Open `chrome://extensions`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select this project folder in Chrome.
7. Open any Slack tab.
8. Click the extension icon to open the side panel.
9. Click `Connect Slack`.
10. Pick a conversation and run your cleanup.

## Everyday Workflow

The normal flow is:

1. Open Slack in Chrome.
2. Open the extension side panel.
3. Click `Connect Slack`.
4. Choose a conversation.
5. Optionally narrow by date or text.
6. Decide whether to include:
   - thread replies
   - files and screenshots
7. Click `Start Bulk Delete`.
8. Watch the live status and log.
9. Use `Cancel` if you want to stop.

## What Each Control Does

### Connection

`Connect Slack`
- Loads the locally captured Slack token.
- Verifies it with Slack.
- Loads the current workspace conversations.

`Reset All Data`
- Clears the captured token from extension storage.
- Clears workspace caches.
- Clears participation cache.
- Clears cleaned markers.
- Resets filters and toggles in the UI.

### Selection

`Conversation`
- The Slack conversation to scan and clean.

`Only show conversations where I've posted`
- Hides conversations where you have never posted.
- Uses a participation cache so future launches are faster.
- DMs are treated as included automatically.

`Start Date/Time` and `End Date/Time`
- Restrict cleanup to a time range.
- Leave both empty to scan the full accessible history.

`Text Filter`
- Case-insensitive substring match against message text.
- Leave empty to match all eligible messages.

`Include thread replies`
- Includes your replies inside threads, not just top-level messages.

`Include files and screenshots`
- Includes your `file_share` messages such as screenshots and file posts.

### Run

`Start Bulk Delete`
- Starts scanning and deleting based on the current filters.

`Cancel`
- Stops an active delete run as soon as the current request or wait finishes.

Live metrics:
- `Top-level`: how many top-level messages have been scanned so far
- `Matched`: how many messages matched your current filters
- `Deleted`: how many deletes succeeded
- `Failed`: how many delete attempts failed
- `Threads`: threaded roots processed during the thread phase

`Activity Log`
- Detailed step-by-step progress output
- useful when a run is large or Slack is rate-limiting

## Cleaned Markers

When a conversation has been fully cleaned successfully, it will be marked in the dropdown as:

- `[Cleaned] ...`

That marker is only applied for a full cleanup run, not for a partial filtered run.

## Multi-Workspace Behavior

State is stored per Slack workspace.

That means the extension keeps separate values for each workspace:

- loaded conversations
- participation cache
- cleaned markers
- last selected conversation
- participation-filter toggle state

Switching workspaces and reconnecting should now keep those states separate.

## Slack API Methods Used

The extension works directly against Slack APIs used by the signed-in browser session:

- `auth.test`
- `users.list`
- `conversations.list`
- `conversations.history`
- `conversations.replies`
- `chat.delete`

## Recommended Precautions

- Start with a small DM or low-risk channel first.
- If you are doing a large cleanup, consider setting a date range first.
- Keep `Include thread replies` off if you only want top-level messages, because thread scanning is slower.
- Only enable `Include files and screenshots` if you really want those posts removed too.
- If a workspace matters operationally, test on a small sample before doing a full-history cleanup.

## Rate Limits And Performance

The extension paces requests conservatively and respects Slack `429` responses.

This means:

- it avoids hitting Slack too aggressively
- large channels can still take time
- thread-heavy channels are slower because each thread needs extra API calls

The side panel shows live progress while this is happening so it is clear the run is still active.

## Troubleshooting

### `Connect Slack` says no token was captured

- Make sure Slack is open in Chrome.
- Reload a Slack tab once.
- Open the side panel and try again.

### Connected, but no conversations appear

- Your current Slack session may verify successfully but still not be allowed to list conversations.
- Reload Slack and reconnect.
- If it still fails, the session token likely does not have access to the conversations you expect.

### DM labels show IDs instead of names

- The extension tries to resolve names with `users.list`.
- If that call is unavailable, it falls back to raw IDs.
- Cleanup still works.

### I switched Slack workspaces

- Reconnect in the new workspace.
- The extension stores conversation/cache state separately per workspace.

### I want to fully stop and clear everything

- Click `Reset All Data`.

## Project Files

- [manifest.json](./manifest.json): Chrome extension manifest
- [background.js](./background.js): token capture and side-panel behavior
- [app.html](./app.html): side-panel UI
- [app.js](./app.js): main extension logic
- [styles.css](./styles.css): side-panel styling

## Local Development

If you make changes:

1. edit the files in this folder
2. go to `chrome://extensions`
3. reload the unpacked extension
4. reopen the Slack side panel and test again
