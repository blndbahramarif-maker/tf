/**
 * Category tree helpers.
 *
 * Categories are stored with a parent id AND a delimited materialised path
 * (`/cars/`), so a subtree is a prefix scan rather than a recursive query
 * (docs/03-database-architecture.md).
 *
 * Attribute inheritance is resolved HERE, once, rather than by each caller.
 */

export interface CategoryNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly slug: string;
  readonly path: string;
  readonly depth: number;
  readonly position: number;
  readonly isActive: boolean;
}

/** A path is delimited at both ends so a prefix scan cannot match a sibling. */
export function buildPath(parentPath: string | null, slug: string): string {
  return parentPath === null ? `/${slug}/` : `${parentPath}${slug}/`;
}

export function depthOf(path: string): number {
  return path.split('/').filter(Boolean).length - 1;
}

/**
 * Ancestor paths, nearest first.
 *
 * `/vehicles/cars/electric/` → `/vehicles/cars/`, `/vehicles/`
 *
 * This ordering is what the commission engine's "walk up until a rule matches"
 * needs, and what attribute inheritance uses.
 */
export function ancestorPaths(path: string): readonly string[] {
  const segments = path.split('/').filter(Boolean);
  const ancestors: string[] = [];
  for (let length = segments.length - 1; length >= 1; length -= 1) {
    ancestors.push(`/${segments.slice(0, length).join('/')}/`);
  }
  return ancestors;
}

export function isDescendantOf(candidate: string, ancestor: string): boolean {
  return candidate !== ancestor && candidate.startsWith(ancestor);
}

export interface CategoryTreeNode<T extends CategoryNode> {
  readonly node: T;
  readonly children: readonly CategoryTreeNode<T>[];
}

/**
 * Builds a tree from a flat list.
 *
 * Nodes whose parent is missing from the list become roots rather than being
 * dropped: a partially-loaded tree should still render.
 */
export function buildTree<T extends CategoryNode>(
  nodes: readonly T[],
): readonly CategoryTreeNode<T>[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string | null, T[]>();

  for (const node of nodes) {
    const parentKey = node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
    const siblings = childrenByParent.get(parentKey) ?? [];
    siblings.push(node);
    childrenByParent.set(parentKey, siblings);
  }

  const assemble = (parentId: string | null): CategoryTreeNode<T>[] =>
    (childrenByParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug))
      .map((node) => ({ node, children: assemble(node.id) }));

  return assemble(null);
}

export interface InheritableAttribute {
  readonly id: string;
  readonly key: string;
  readonly categoryId: string;
  readonly inheritToChildren: boolean;
  readonly position: number;
}

/**
 * Resolves the attributes that apply to a category, including inherited ones.
 *
 * `ancestorsNearestFirst` must be ordered nearest-ancestor-first. A child
 * defining the same KEY as an ancestor overrides it — that is how a subcategory
 * narrows an inherited field rather than duplicating it.
 */
export function resolveAttributes<T extends InheritableAttribute>(
  ownAttributes: readonly T[],
  ancestorAttributesNearestFirst: readonly T[],
): readonly T[] {
  const byKey = new Map<string, T>();

  for (const attribute of ownAttributes) byKey.set(attribute.key, attribute);

  for (const attribute of ancestorAttributesNearestFirst) {
    if (!attribute.inheritToChildren) continue;
    // Nearest-first plus "first wins" means the closest definition of a key
    // survives and more distant ancestors do not clobber it.
    if (!byKey.has(attribute.key)) byKey.set(attribute.key, attribute);
  }

  return [...byKey.values()].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
}
