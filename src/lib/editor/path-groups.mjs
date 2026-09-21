/** Pure path collections are the source list's groups. Mixed collections remain
 * available to advanced tools and are never silently treated as path owners.
 */
export function projectPathGroups(source) {
  const groups = (source.collections || [])
    .filter((collection) =>
      collection.members.every((member) => member.ref.kind === 'path'),
    )
    .map((collection) => ({
      id: collection.id,
      name: collection.name,
      pathIds: [...new Set(collection.members.map((member) => member.pathId))],
    }));
  const memberships = Object.fromEntries(
    (source.orderedPathIds || source.paths.map((path) => path.id)).map((id) => [
      id,
      groups
        .filter((group) => group.pathIds.includes(id))
        .map((group) => group.id),
    ]),
  );
  return { groups, memberships };
}
