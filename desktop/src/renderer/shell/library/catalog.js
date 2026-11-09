/* 标签目录：来自主进程的标签端点，全局只取一次并按 id 建索引。 */
let tagCatalog = null;
let tagCatalogError = "";

export function getTagCatalog() {
  return tagCatalog;
}

export function setTagCatalog(value) {
  tagCatalog = value;
}

export function getTagCatalogError() {
  return tagCatalogError;
}

export function setTagCatalogError(value) {
  tagCatalogError = value;
}

export function catalogTag(id) {
  if (!tagCatalog || !tagCatalog.byId) return null;
  return tagCatalog.byId.get(Number(id)) || null;
}

export function selectedTagGroups(ids) {
  const groups = new Map();
  for (const raw of ids || []) {
    const id = Number(raw) || 0;
    if (!id) continue;
    const tag = catalogTag(id);
    const type = tag ? Number(tag.type) || 0 : 0;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(id);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => [...new Set(group)].sort((a, b) => a - b));
}

export function prepareCatalog(payload) {
  if (!payload || !Array.isArray(payload.tags) || !payload.tags.length) return null;
  const byId = new Map();
  for (const tag of payload.tags) byId.set(Number(tag.id), tag);
  return Object.assign({}, payload, { byId });
}
