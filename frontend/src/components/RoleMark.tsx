import { ShieldCheck } from 'lucide-react'

import type { Role } from '../api'
import { roleLabel } from '../lib/roles'

// The shield beside a name: this person is verified as one of Tare's own.
// Administrators wear it in gold, reviewers in the accent, and hovering says
// "Verified"; the label under it on a profile says which role.
//
// Nothing at all for a member, which is most people.
export function RoleMark({ role }: { role: Role }) {
  const label = roleLabel(role)
  if (label === null) return null
  const colour = role === 'admin' ? 'text-gold' : 'text-accent'
  return (
    <ShieldCheck
      className={`ml-1 inline h-3.5 w-3.5 shrink-0 align-[-0.15em] ${colour}`}
      strokeWidth={2.25}
      role="img"
      aria-label={`Verified ${label.toLowerCase()}`}
    >
      <title>Verified</title>
    </ShieldCheck>
  )
}
