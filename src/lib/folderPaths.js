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
