function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  // Optional. One or more guild (server) ids, comma-separated. When set, slash
  // commands register instantly to each of those guilds — ideal for a cluster
  // of union servers, or for fast iteration during development. When omitted,
  // commands register globally (all servers, up to ~1h to appear).
  guildIds: (process.env.DISCORD_GUILD_ID ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
} as const;
