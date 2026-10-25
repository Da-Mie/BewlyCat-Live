export interface ProjectedComment<T> {
  item: T
  parent: T | null
  depth: number
  hasChildren: boolean
}

export function projectCommentTree<T, K>(items: T[], keyOf: (item: T) => K, parentOf: (item: T) => K | null, visible: (item: T) => boolean): ProjectedComment<T>[] {
  const byKey = new Map(items.map(item => [keyOf(item), item]))
  const visibility = new Map(items.map(item => [item, visible(item)]))
  const children = new Map<T | null, T[]>()
  for (const item of items) {
    if (!visibility.get(item))
      continue
    let key = parentOf(item)
    let parent: T | null = null
    const visited = new Set([keyOf(item)])
    while (key !== null && !visited.has(key)) {
      visited.add(key)
      const candidate = byKey.get(key)
      if (candidate === undefined)
        break
      if (visibility.get(candidate)) {
        parent = candidate
        break
      }
      key = parentOf(candidate)
    }
    const siblings = children.get(parent) ?? []
    siblings.push(item)
    children.set(parent, siblings)
  }
  const result: ProjectedComment<T>[] = []
  const visited = new Set<T>()
  function append(root: T) {
    const queue: Array<{ item: T, parent: T | null, depth: number }> = [{ item: root, parent: null, depth: 0 }]
    while (queue.length) {
      const row = queue.pop()!
      if (visited.has(row.item))
        continue
      visited.add(row.item)
      const descendants = children.get(row.item) ?? []
      result.push({ ...row, hasChildren: descendants.length > 0 })
      for (let index = descendants.length - 1; index >= 0; index--)
        queue.push({ item: descendants[index], parent: row.item, depth: row.depth + 1 })
    }
  }
  for (const root of children.get(null) ?? [])
    append(root)
  // Malformed cycles must not suppress otherwise visible comments.
  for (const item of items) {
    if (visibility.get(item) && !visited.has(item))
      append(item)
  }
  return result
}
