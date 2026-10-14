/** Application roles, one per user (auth design A6). Order carries no meaning: rules list roles explicitly (A7). */
export const ROLES = ['user', 'editor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that enter the management area. */
export const MANAGEMENT_ROLES = ['editor', 'admin'] as const satisfies readonly Role[];

/** What the access guard puts on the request for a valid session. */
export type AuthenticatedUser = Readonly<{ id: string; role: Role }>;
