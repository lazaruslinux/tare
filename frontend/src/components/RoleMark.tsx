import { ShieldCheck } from 'lucide-react'

import type { Role } from '../api'
import { roleLabel } from '../lib/roles'

// The shield beside a name. Reviewers and administrators wear the same one:
// what a member wants to know is that this person keeps the database right,
// and which of the two roles it is is what the label says.
//
// Nothing at all for a member, which is most people.
export function RoleMark({ role }: { role: Role }) {
  const label = roleLabel(role)
  if (label === null) return null
  return (
    <ShieldCheck
      className="ml-1 inline h-3.5 w-3.5 shrink-0 align-[-0.15em] text-accent"
      strokeWidth={2.25}
      role="img"
      aria-label={label}
    />
  )
}
