// The password rule, in the words the screens use for it. The server is the
// authority and refuses anything shorter with its own sentence; this is the
// hint shown while somebody is still typing, and it lives in one place so the
// two screens that ask for a password cannot drift apart.

export const MIN_PASSWORD_LENGTH = 10

// A guide rather than a rule. The backend has one requirement, a length, and
// saying anything stricter here would be inventing a rule it does not enforce.
export function strength(password: string): string {
  if (!password) {
    return `At least ${MIN_PASSWORD_LENGTH} characters. A few words you will remember beats a short one you will not.`
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `${MIN_PASSWORD_LENGTH - password.length} more to go.`
  }
  return 'Long enough.'
}
