export function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <>
      <p className="t-micro mb-2">{title}</p>
      <div className="t-card text-sm text-muted">{note}</div>
    </>
  )
}
