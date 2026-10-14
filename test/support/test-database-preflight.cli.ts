import { testDatabasePreflight } from './test-database-preflight.js';

// `yarn test:db-guard`: exits 1 unless the configured database is a *_test database (I21).
const result = testDatabasePreflight();
if (result.ok) {
  console.log(result.message);
} else {
  console.error(result.message);
  process.exitCode = 1;
}
