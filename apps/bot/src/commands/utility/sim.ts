import { makeLinkCommand } from '../../lib/linkCommand.js';

export const command = makeLinkCommand({
  name: 'sim',
  description: 'Link the NIKKE solo-raid damage simulator.',
  label: 'NIKKE Sim',
  url: 'https://www.nikkesim.app/',
  note: 'Solo-raid damage simulator',
});
