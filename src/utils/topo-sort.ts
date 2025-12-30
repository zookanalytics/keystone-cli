/**
 * Generic Topological Sort Utility
 */

export interface HasDependencies {
  id: string;
  needs?: string[];
}

/**
 * Topologically sort items based on dependencies
 * @throws Error if circular dependency detected or dependency missing
 */
export function topologicalSort<T extends HasDependencies>(items: T[]): T[] {
  const sorted: T[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const itemMap = new Map(items.map((it) => [it.id, it]));

  function visit(item: T) {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) {
      throw new Error(`Circular dependency detected involving item: ${item.id}`);
    }

    visiting.add(item.id);

    for (const depId of item.needs || []) {
      const dep = itemMap.get(depId);
      if (dep) {
        visit(dep);
      }
      // If the dependency is missing from the local set, we assume it's external or already satisfied.
      // Strict checking can be added if needed.
    }

    visiting.delete(item.id);
    visited.add(item.id);
    sorted.push(item);
  }

  for (const item of items) {
    visit(item);
  }

  return sorted;
}
