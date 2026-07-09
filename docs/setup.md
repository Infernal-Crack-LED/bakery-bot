# Setting Maiden up in your server

Welcome! 🧁 This is everything you need to do after adding Maiden. It's quick —
two steps really matter, and the rest is optional or happens on its own. It's all
done in Discord; you'll never touch code.

> **Prefer it in Discord?** Run **`/setup-guide`** and Maiden will DM you this
> checklist.

> **If you only read one thing:** Maiden can't post in a **locked channel** (news
> feeds, announcement channels) unless you explicitly let her. If you set
> something up and _nothing ever appears_, that's almost always why — see step 1.

## 1. Give Maiden permission to talk

Adding Maiden creates a role for her (usually called "Maiden"). Give that role
these permissions — either server-wide (_Server Settings → Roles → Maiden_) or
just in the channels she'll use:

- **View Channels**
- **Send Messages**
- **Embed Links** — so her `/nikke` cards and welcome messages look right
- **Read Message History** — so she can read the feed she's replying to

**The catch with locked channels.** News and announcement channels usually block
_everyone_ from posting, and Maiden is caught by that too. So for each channel you
want her to post in — your news channel, your announcements/patch-notes channel,
your welcome channel — open **Edit Channel → Permissions**, add the Maiden role,
and switch on **View Channel**, **Send Messages**, and **Embed Links**.

Skip this and you'll see the classic symptom: you set up news timestamps, but no
`🕒` ever shows up. She read the post and worked out the time — she just isn't
allowed to reply.

_(Using `/perms`? She'll also need **Manage Roles**, and her role has to sit
**above** any role she edits. Otherwise you can ignore this.)_

## 2. Turn on the features you want

Everything is set with **`/config`** (only admins can see it). Run **`/config
show`** anytime to check what's on. Pick and choose — nothing here is required.

- **News timestamps** — `/config news #channel`
  Maiden watches that channel and replies to game-news/tweet posts with the event
  time in everyone's own timezone. Add more channels by running it again; add
  `remove:true` to stop watching one. _(Needs Send Messages there — see step 1.)_
- **Welcome messages** — `/config welcome #channel`
  Greets each new member with a little embed.
- **Mod-log** — `/config modlog #channel`
  Keeps a log of audited actions like `/perms` edits.
- **Quotes** — `/config quotes emoji:⭐ threshold:3`
  React to a message with your chosen emoji, and once it hits the threshold Maiden
  saves it. Pull up anyone's greatest hits with `/quotes @user`.

## 3. NIKKE data takes care of itself

`/nikke`, `/time`, and the guide commands work right away, and the NIKKE data
refreshes on its own (daily, and after every update). Want a manual refresh? An
admin can run **`/sync`**.

## 4. Check it's working

- **`/nikke rapi`** → you get a profile card back.
- **`/config show`** → shows the settings you just picked.
- Post something with a date in a watched news channel — e.g.
  `Event 7/9 5:00 ~ 7/30 4:59 (UTC+9)` — and Maiden should reply with a `🕒`
  stamp.

## If something's not working

- **News stamps never appear** → Maiden can't Send Messages in that channel. Fix
  the locked-channel permissions in step 1.
- **Welcome or mod-log messages don't post** → same fix, in that channel.
- **A command is missing right after inviting** → commands can take up to an hour
  to show up the very first time. After that, new servers get them instantly.
- **Quotes aren't saving** → double-check `/config show`, and that people are
  reacting with _exactly_ the emoji you set, enough times to hit the threshold.
- **`/perms` won't change something** → Maiden needs **Manage Roles**, and her role
  must be above the one she's editing.

---

Running your own copy of Maiden instead of using the hosted one? Head to
**[development.md](development.md)**.
