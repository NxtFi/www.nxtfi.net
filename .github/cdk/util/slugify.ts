export function slugify(str: string, replacement = '-'): string {
  let slug = str.normalize()
  slug = slug.replace(/[^A-Za-z0-9\s]+/g, replacement)
  slug = slug.replace(/^-+|-+$/g, "")
  slug = slug.trim()
  slug = slug.toLowerCase()

  return slug
}
