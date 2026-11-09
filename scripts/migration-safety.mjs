export async function setMigrationSafetyTimeouts(client) {
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '10min'");
}
