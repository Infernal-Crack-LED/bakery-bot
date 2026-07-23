import { makeLinkCommand } from '../../lib/linkCommand.js';

export const command = makeLinkCommand({
  name: 'mechanics',
  description: 'Link the NIKKE sim mechanics reference.',
  label: 'Sim Mechanics',
  url: 'https://www.nikkesim.app/mechanics',
  note: 'How the simulator models each mechanic',
});
