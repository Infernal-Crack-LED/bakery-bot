import { makeLinkCommand } from '../../lib/linkCommand.js';

export const command = makeLinkCommand({
  name: 'build-guide',
  description: "Link Tsareena's NIKKE build guide.",
  label: "Tsareena's NIKKE Build Guide",
  url: 'https://docs.google.com/spreadsheets/d/16EECdnWsdbfeJ_r1KKG0vIhpdeagAbMOjy6xKsSTvh4/edit?gid=0#gid=0',
  note: 'Community build sheet',
});
