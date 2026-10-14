import { assertTestDatabase, testDatabaseName } from './test-database-guard.js';

describe('testDatabaseName', () => {
  it.each([
    ['postgres://u:p@localhost:5433/xuan_test', 'xuan_test'],
    ['postgresql://u:p@localhost:5433/xuan_test?sslmode=disable', 'xuan_test'],
  ])('reads the database name from %s', (url, name) => {
    expect(testDatabaseName(url)).toBe(name);
  });

  it.each([
    ['a development database', 'postgres://u:p@localhost:5433/xuan_dev'],
    ['a name that only contains _test', 'postgres://u:p@localhost:5433/xuan_test_backup'],
    ['a missing database name', 'postgres://u:p@localhost:5433/'],
    ['an unparsable URL', 'not a url'],
    ['an empty value', ''],
  ])('fails closed on %s', (_case, url) => {
    expect(() => testDatabaseName(url)).toThrow(/I21/);
  });

  it('never prints the URL (it holds the password)', () => {
    expect(() => testDatabaseName('postgres://u:s3cret@localhost:5433/xuan_dev')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('s3cret') }),
    );
  });
});

describe('assertTestDatabase', () => {
  it('passes when the configured and connected databases are the same *_test database', () => {
    expect(() =>
      assertTestDatabase('postgres://u:p@localhost:5433/xuan_test', 'xuan_test'),
    ).not.toThrow();
  });

  it('fails when the connection reports a different database than configured', () => {
    expect(() => assertTestDatabase('postgres://u:p@localhost:5433/xuan_test', 'xuan_dev')).toThrow(
      /I21/,
    );
  });
});
