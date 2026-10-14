import { AppError } from '../../errors/app-error.js';
import { assertCanManageOwnedResource, canManageOwnedResource } from './ownership.js';
import type { AuthenticatedUser } from './role.js';

const editor: AuthenticatedUser = { id: 'editor-1', role: 'editor' };
const otherEditor: AuthenticatedUser = { id: 'editor-2', role: 'editor' };
const admin: AuthenticatedUser = { id: 'admin-1', role: 'admin' };
const user: AuthenticatedUser = { id: 'user-1', role: 'user' };

describe('canManageOwnedResource', () => {
  it.each([
    ['an editor, own resource', editor, 'editor-1', true],
    ["an editor, another editor's resource", otherEditor, 'editor-1', false],
    ["an admin, an editor's resource", admin, 'editor-1', true],
    ['an admin, own resource', admin, 'admin-1', true],
    ['a user, even their own id', user, 'user-1', false],
  ])('%s → %s', (_case, actor, ownerId, expected) => {
    expect(canManageOwnedResource(actor, ownerId)).toBe(expected);
  });
});

describe('assertCanManageOwnedResource', () => {
  it('throws FORBIDDEN for a non-owner editor', () => {
    expect(() => assertCanManageOwnedResource(otherEditor, 'editor-1')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', kind: 'forbidden' }),
    );
    expect(() => assertCanManageOwnedResource(otherEditor, 'editor-1')).toThrow(AppError);
  });

  it('passes for the owner', () => {
    expect(() => assertCanManageOwnedResource(editor, 'editor-1')).not.toThrow();
  });
});
