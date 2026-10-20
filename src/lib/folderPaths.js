export function folderPaths(tree) {
  return tree.flatMap((node) => node.type === 'folder' ? [node.path, ...folderPaths(node.children)] : []);
}

export function normalizeFolders(path, isFolder, existing = []) {
  const parts = path.split('/');
  let original = '';
  return parts.map((part, i) => {
    original = original ? `${original}/${part}` : part;
    return (isFolder || i < parts.length - 1) && !existing.includes(original) ? part.replace(/ /g, '_') : part;
  }).join('/');
}

export function migrationPlan(tree) {
  // Deepest first keeps child source paths valid while their parents still have their original names.
  return folderPaths(tree).filter((p) => p.split('/').pop().includes(' '))
    .sort((a, b) => b.split('/').length - a.split('/').length)
    .map((from) => {
      const parts = from.split('/');
      parts[parts.length - 1] = parts.at(-1).replace(/ /g, '_');
      return { from, to: parts.join('/') };
    });
}
