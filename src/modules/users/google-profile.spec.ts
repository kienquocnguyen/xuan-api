import { profileFromGoogle } from './google-profile.js';

const base = { subject: 's-1', email: 'Xuan@Example.com', emailVerified: true };

describe('profileFromGoogle', () => {
  it('lowercases the email and keeps the name and picture', () => {
    expect(
      profileFromGoogle({ ...base, name: '  Xuân Nguyễn ', picture: 'https://lh3.example/p.jpg' }),
    ).toEqual({
      email: 'xuan@example.com',
      displayName: 'Xuân Nguyễn',
      avatarUrl: 'https://lh3.example/p.jpg',
    });
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
  ])('falls back to the email local part when the name is %s', (_case, name) => {
    expect(profileFromGoogle({ ...base, name }).displayName).toBe('Xuan');
  });

  it('truncates an overlong name to 200 characters', () => {
    expect(profileFromGoogle({ ...base, name: 'n'.repeat(250) }).displayName).toHaveLength(200);
  });

  it.each([
    ['missing', undefined],
    ['too long', `https://lh3.example/${'p'.repeat(2100)}`],
    ['not https', 'http://lh3.example/p.jpg'],
  ])('drops a picture that is %s', (_case, picture) => {
    expect(profileFromGoogle({ ...base, picture }).avatarUrl).toBeNull();
  });
});
