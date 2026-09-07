// The password rule, in the words the screens use for it. The server is the
// authority and refuses anything shorter with its own sentence; this is the
// hint shown while somebody is still typing, and it lives in one place so the
// two screens that ask for a password cannot drift apart.

export const MIN_PASSWORD_LENGTH = 10

// A guide rather than a rule. The backend has one requirement, a length, and
// saying anything stricter here would be inventing a rule it does not enforce.
// One line under the field, in three states: the rule, the count, the reached.
export function strength(password: string): string {
  if (!password) return `${MIN_PASSWORD_LENGTH} character minimum`
  if (password.length < MIN_PASSWORD_LENGTH) {
    const left = MIN_PASSWORD_LENGTH - password.length
    return `${left} ${left === 1 ? 'character' : 'characters'} left`
  }
  return 'Reached minimum'
}
