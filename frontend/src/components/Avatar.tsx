// The picture a member is shown by, in the two sizes anything shows it at: the
// row size the food thumbnails use, and the larger one a profile leads with.
//
// No picture is not a gap. It is the member's own initial in the same square,
// so a list of members reads as a list either way and nobody is given a face
// they did not choose.

const SIZES = {
  row: 'h-10 w-10 rounded-lg text-sm',
  page: 'h-20 w-20 rounded-xl text-2xl',
}

export function Avatar({
  url,
  name,
  size = 'row',
}: {
  url: string | null
  // What the initial is taken from, which is the name shown beside it.
  name: string
  size?: 'row' | 'page'
}) {
  const box = SIZES[size]
  if (url !== null) {
    return (
      <img
        src={url}
        alt=""
        className={`${box} shrink-0 border border-line object-cover`}
      />
    )
  }
  return (
    <span className={`t-phototile ${box}`} aria-hidden="true">
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}
