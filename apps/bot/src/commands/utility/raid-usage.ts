import { makeLinkCommand } from '../../lib/linkCommand.js';

export const command = makeLinkCommand({
  name: 'raid-usage',
  description: 'Link the Enikk app (raid usage history).',
  label: 'Enikk App',
  url: 'https://enikk.app/',
  note: 'Raid usage history',
});
