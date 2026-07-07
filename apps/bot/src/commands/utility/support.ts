import { makeLinkCommand } from '../../lib/linkCommand.js';

export const command = makeLinkCommand({
  name: 'support',
  description: "Get an invite to Maiden's support server.",
  label: 'Maiden Support Server',
  url: 'https://discord.gg/3Yx4pHB88R',
  note: 'Questions, bugs & suggestions',
});
