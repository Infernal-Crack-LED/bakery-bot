# Privacy Policy for Maiden

_Last updated: 2026-07-07_

This Privacy Policy explains what information the **Maiden** Discord bot ("Maiden", "the Bot", "we") collects, how it is used, and your choices. By adding Maiden to a server or using its commands, you agree to this policy.

Maiden is a community bot for the game NIKKE: Goddess of Victory. It is **not affiliated with, endorsed by, or sponsored by** Discord Inc., SHIFT UP, Level Infinite, or the operators of any third-party data source.

## Information we collect

Maiden only stores the minimum needed to work. Specifically:

- **Discord identifiers** — server (guild) IDs, channel IDs, and, for the features below, user IDs and usernames/tags. These are how Discord identifies servers, channels, and people.
- **Server configuration** — the channels an admin sets with `/config` (news, welcome, and mod-log channels).
- **Feature requests** — when you use `/feature-request`, we store the text you submit along with your Discord user ID and username, so the maintainer can review it. **This may also be posted as a public GitHub issue** (see "Third parties" below).
- **Administrative audit records** — when a server admin uses `/perms`, we record who ran it, the affected role/target, and a reason, so the action is auditable.

We also store non-personal **game data** (NIKKE character tiers, stats, and builds) fetched from public sources; this contains no information about you.

## Information we do **not** collect

- **We do not read or store your messages.** Maiden uses Discord's Message Content access **only** in channels a server admin explicitly designates as "news" channels, and **only** to detect an event date/time in an embed so it can reply with a localized timestamp. That message content is processed in memory and **is not stored**.
- We do not store direct messages, message history, voice data, or analytics/advertising trackers.
- We do not sell or rent your data to anyone.

## How we use information

Collected information is used solely to operate Maiden's features — remembering your server's configuration, adding timestamps in your chosen channels, delivering command responses, recording admin audit actions, and passing along feature requests.

## Third parties

- **GitHub** — if a GitHub integration is configured, `/feature-request` submissions may be posted as issues on the project's **public** GitHub repository, including your Discord username and the text you wrote. Do not include sensitive information in a feature request. See GitHub's [Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement).
- **Hosting** — Maiden and its database run on cloud infrastructure (Railway); data is stored in a PostgreSQL database there.
- **Public game data sources** — Maiden fetches public NIKKE data from third parties (e.g. Nikke Synergy, Prydwen, and a community spreadsheet). **No personal data is sent to them**; Maiden only reads their public data.

## Data retention

We keep the data above for as long as Maiden is in your server or as needed to provide the service. Removing Maiden from a server, or requesting deletion (below), removes the associated data. Feature-request records and any GitHub issues already created are retained unless you ask us to remove them.

## Your choices and rights

- **Server configuration** can be changed or cleared anytime with `/config`.
- **Removing the Bot** from a server stops all further processing for that server.
- **Deletion requests** — to request deletion of data associated with your Discord user ID or server, contact the maintainer (see "Contact"). Note that content already published as a public GitHub issue may need to be removed there separately.

## Children

Maiden is not directed to children. You must meet Discord's minimum age requirement (at least 13, or older where required by local law) to use Discord and Maiden.

## Changes to this policy

We may update this policy from time to time. Material changes will be reflected by updating the "Last updated" date above.

## Contact

For privacy questions or deletion requests, contact the maintainer via **Discord** or by opening an issue on the project's GitHub repository (links are in the [README](README.md)).
