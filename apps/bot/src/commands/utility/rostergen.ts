import { makeLinkCommand } from '../../lib/linkCommand.js';

export const command = makeLinkCommand({
  name: 'rostergen',
  description: 'Link the NIKKE solo-raid roster generator.',
  label: 'Roster Generator',
  url: 'https://www.nikkesim.app/roster',
  note: 'Generate optimal solo-raid rosters',
});
