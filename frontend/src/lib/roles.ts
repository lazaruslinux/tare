import type { Me, Role } from '../api'

// Who does what, in one place. Everything a reviewer may do asks `reviews`;
// everything that is the instance's own business keeps asking is_admin.

// What each role is called where it is spelled out: the shield's label, and the
// word under a member's name on their page.
export const ROLE_LABEL: Record<'admin' | 'reviewer', string> = {
  admin: 'Administrator',
  reviewer: 'Reviewer',
}

export function roleLabel(role: Role): string | null {
  return role === null ? null : ROLE_LABEL[role]
}

// Whether this account judges what reaches the Tare database. An administrator
// does by being one, which is why nothing reads is_reviewer on its own.
export function reviews(me: Me): boolean {
  return me.role !== null
}
