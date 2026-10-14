import type { GoogleIdentity } from './google/google-identity.gateway.js';

export type SyncedProfile = Readonly<{
  email: string;
  displayName: string;
  avatarUrl: string | null;
}>;

/** The profile fields Google bootstraps and syncs on each sign-in (auth design A10), fitted to `users`. */
export function profileFromGoogle(identity: GoogleIdentity): SyncedProfile {
  const email = identity.email.toLowerCase();
  const name = identity.name?.trim() || identity.email.split('@')[0];
  const picture = identity.picture;
  const avatarUrl =
    picture && picture.length <= 2048 && picture.startsWith('https://') ? picture : null;
  return { email, displayName: name.slice(0, 200), avatarUrl };
}
