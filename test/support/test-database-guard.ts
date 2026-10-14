const TEST_DATABASE = /^[a-z0-9_]+_test$/;

/**
 * Returns the database name from DATABASE_URL, or throws unless it is a *_test database (I21).
 * Fails closed: an unparsable URL or a missing name is a refusal. Never echoes the URL (it holds the password).
 */
export function testDatabaseName(databaseUrl: string): string {
  let name = '';
  try {
    name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('Refusing to run: DATABASE_URL is not a parsable URL (I21).');
  }
  if (!TEST_DATABASE.test(name)) {
    throw new Error(`Refusing to run: database "${name}" is not a *_test database (I21).`);
  }
  return name;
}

/** The configured name must be a *_test database, and the live connection must report that same name. */
export function assertTestDatabase(databaseUrl: string, connectedDatabase: string): void {
  const configured = testDatabaseName(databaseUrl);
  if (connectedDatabase !== configured) {
    throw new Error(
      `Refusing to run: connected to "${connectedDatabase}", configured "${configured}" (I21).`,
    );
  }
}
