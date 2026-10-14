import type { DataSource, Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import type { AppConfig } from '../../config/load-config.js';
import type { User } from './user.entity.js';
import { SignInError } from './users.errors.js';
import { UsersService } from './users.service.js';

const uniqueViolation = (constraint: string) =>
  new QueryFailedError(
    'INSERT …',
    [],
    Object.assign(new Error('duplicate'), { code: '23505', constraint }),
  );

const identity = { subject: 'sub-1', email: 'a@example.com', emailVerified: true };
const user = { id: 'u-1', role: 'user' } as User;

/** The retry path of signInWithGoogle, which real concurrency hits only by timing. */
describe('UsersService.signInWithGoogle retry', () => {
  const service = (transaction: ReturnType<typeof vi.fn>) =>
    new UsersService(
      {} as Repository<User>,
      { transaction } as unknown as DataSource,
      { auth: { adminEmails: [] } } as unknown as AppConfig,
    );

  it.each(['uq_users_email', 'uq_auth_identities_provider_provider_user_id'])(
    'retries once after losing a first-sign-in race on %s',
    async (constraint) => {
      const transaction = vi
        .fn()
        .mockRejectedValueOnce(uniqueViolation(constraint))
        .mockResolvedValueOnce(user);
      await expect(service(transaction).signInWithGoogle(identity)).resolves.toBe(user);
      expect(transaction).toHaveBeenCalledTimes(2);
    },
  );

  it('a repeated email collision becomes ACCOUNT_CONFLICT', async () => {
    const transaction = vi.fn().mockRejectedValue(uniqueViolation('uq_users_email'));
    await expect(service(transaction).signInWithGoogle(identity)).rejects.toEqual(
      new SignInError('ACCOUNT_CONFLICT'),
    );
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors', async () => {
    const boom = new Error('connection lost');
    const transaction = vi.fn().mockRejectedValue(boom);
    await expect(service(transaction).signInWithGoogle(identity)).rejects.toBe(boom);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
