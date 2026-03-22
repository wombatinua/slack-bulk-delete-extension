# Slack Bulk Delete

Clean-room Chrome extension for bulk deletion of the authenticated user's own Slack messages.

## What It Does

- uses Slack Web API directly
- can capture your current Slack Web session token locally from browser requests
- stores token and basic state in `chrome.storage.local`
- loads conversations from the authenticated workspace
- filters to messages authored by the authenticated user
- supports optional time and text filters
- can scan thread replies
- has a dry-run mode before deletion

## What It Does Not Do

- no vendor code
- no vendor proxy
- no license checks
- no admin impersonation
- no deletion of other users' messages

## Slack API Methods Used

- `auth.test`
- `conversations.list`
- `conversations.history`
- `conversations.replies`
- `chat.delete`

## Token Requirements

Use an authorized Slack token that is permitted to call the methods above in your workspace.

The easiest path for your case is:

1. stay logged into Slack Web in Chrome
2. reload any open Slack workspace tab once
3. open this extension
4. click `Load Captured Token`
5. click `Verify Token`

In practice, the token must be able to:

- verify with `auth.test`
- read the conversations you want to scan
- delete the authenticated user's own messages with `chat.delete`

## Load The Extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder:
   `/Users/dmytro/Downloads/slack-bulk-delete-inhouse`

## Recommended Workflow

1. Open Slack Web and make sure you are already signed in
2. Reload the Slack tab once so the extension can capture the outgoing session token locally
3. Open this extension and click `Load Captured Token`
4. Click `Verify Token`
5. Refresh channels
6. Pick a conversation
7. Leave `Dry run` enabled for the first pass
8. Review the log
9. Disable `Dry run`
10. Run deletion

## Notes

- This tool is intentionally conservative and serializes deletes.
- Slack may return `429` rate limits; the extension waits and retries.
- Thread scanning can be slow on large channels because each thread requires extra API calls.
