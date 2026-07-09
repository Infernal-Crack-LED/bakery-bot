# Setting up Maiden in your server

A short checklist for server admins who just added Maiden. Steps 1 and 2 are the
important ones — the rest is optional or automatic. Everything here is done in
Discord; you don't need to touch any code.

> **The single most common problem:** Maiden can't post in a **locked channel**
> (news feeds, announcement channels) because that channel denies "Send
> Messages" to everyone. If you set up news timestamps or patch notes and
> **nothing ever appears**, it's almost always this — see step 1.

---

## 1. Give Maiden's role the right permissions

When you invite Maiden she gets a role (usually named "Maiden"). She needs these
permissions — grant them **server-wide** under _Server Settings → Roles →
Maiden_, or per-channel for just the channels she works in:

- **View Channels**
- **Send Messages**
- **Embed Links** (so `/nikke`, welcome, and mod-log embeds render)
- **Read Message History** (so she can read the news feed and reply to posts)
- **Send Messages in Threads** — only if you want her to work inside threads

### ⚠️ Locked / announcement channels need an explicit allow

News and announcement channels are usually set so **@everyone can't post**.
Maiden's role inherits that "no", so even with the server-wide permissions above
she still can't talk there. For **each** channel you want her to post in
(your news channel, your patch-notes/announcement channel, your welcome
channel), open **Edit Channel → Permissions**, add Maiden's role, and set:

- ✅ View Channel
- ✅ Send Messages
- ✅ Embed Links

**Symptom if you skip this:** you run `/config news #channel`, the parsing works
fine, but no `🕒` timestamp ever shows up — because the reply is being blocked.

### Only if you'll use `/perms`

`/perms` (the bulk permission editor) needs Maiden to have **Manage Roles**, and
her role must sit **above** any role she edits (drag it up in _Server Settings →
Roles_). Skip this if you won't use `/perms`.

---

## 2. Configure the features you want

All configuration is done with **`/config`** (hidden from non-admins). Run
**`/config show`** at any time to see the current setup.

| What                     | Command                               | Notes                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **News auto-timestamps** | `/config news #channel`               | Maiden watches that channel for game-news / tweet posts and replies with each event time in everyone's local timezone. Run it again to add more channels; add `remove:true` to stop watching one. **Needs Send Messages there (step 1 ⚠️).** |
| **Welcome messages**     | `/config welcome #channel`            | Greets each new member with an embed. Needs Send Messages + Embed Links there.                                                                                                                                                               |
| **Mod-log**              | `/config modlog #channel`             | Where audited actions (e.g. `/perms` edits) are logged.                                                                                                                                                                                      |
| **Quotes**               | `/config quotes emoji:⭐ threshold:3` | Turns on the quote-saver: react to a message with that emoji, and once it hits the threshold Maiden saves it. View a member's quotes with `/quotes @user`. Threshold defaults to 3.                                                          |

Nothing here is required — set up only the features you want. News timestamps and
quotes are the two most servers turn on.

---

## 3. NIKKE data (usually nothing to do)

`/nikke`, `/time`, and the guide commands work out of the box. The NIKKE data
Maiden looks up refreshes **automatically** (daily, and after each update). If
you ever want to force a refresh, an admin can run **`/sync`**.

---

## 4. Verify it's working

- **`/nikke rapi`** → returns a profile embed.
- **`/config show`** → reflects the channels/settings you configured.
- In a watched news channel, wait for (or post) something with a date/time →
  Maiden replies with a `🕒` local-time stamp. To test without waiting, an admin
  can post a message containing e.g. `Event 7/9 5:00 ~ 7/30 4:59 (UTC+9)`.

---

## Troubleshooting

- **News timestamps never appear** → Maiden lacks **Send Messages** in that
  channel. Locked/announcement channels need an explicit allow (step 1 ⚠️).
- **Welcome or mod-log messages don't post** → same thing, in that channel.
- **A slash command is missing right after inviting** → commands are global and
  can take up to ~1 hour to appear the first time. New servers pick up the
  existing commands automatically after that.
- **Quotes aren't being saved** → check `/config show`; make sure the quote emoji
  is set and members are reacting with **exactly** that emoji, enough times to
  hit the threshold.
- **`/perms` says it can't change something** → Maiden needs **Manage Roles** and
  her role must be **above** the role being edited.

---

## Self-hosting / running your own copy

This page is for server admins using the hosted Maiden. If you want to run your
own instance (Discord token, database, environment variables, deploy), see
**[development.md](development.md)**.
