export class Service {
  constructor(repo) {
    this.repo = repo;
  }

  label(key) {
    const row = this.repo.find(key);
    if (row === null) return 'missing';
    return 'found:' + String(row.name).toUpperCase();
  }
}

export function collect(items, sink) {
  for (const item of items) {
    if (item > 0) sink(item);
  }
  return items.length;
}
