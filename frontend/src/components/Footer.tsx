// One line under everything, on every screen the app has. What it is, what it
// is licensed as, and who made it.
export function Footer({ version }: { version?: string }) {
  return (
    <p className="t-note mt-4 text-center">
      Tare{version ? ` ${version}` : ''} ·{' '}
      <a
        className="text-accent"
        href="https://www.gnu.org/licenses/agpl-3.0.html"
        target="_blank"
        rel="noopener"
      >
        AGPL-3.0
      </a>{' '}
      · developed by{' '}
      <a className="text-accent" href="https://lazaruslinux.com" target="_blank" rel="noopener">
        Lazarus Labs
      </a>
    </p>
  )
}
