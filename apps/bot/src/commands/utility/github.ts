import { makeLinkCommand } from '../../lib/linkCommand.js';

export const command = makeLinkCommand({
  name: 'github',
  description: "Link Maiden's source code on GitHub.",
  label: 'Maiden on GitHub',
  url: 'https://github.com/Infernal-Crack-LED/bakery-bot',
  note: 'Source code, issues & contributions',
});
