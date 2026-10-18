export type ServerPage<T> = {
  items: T[];
  page: {
    offset: number;
    limit: number;
    total: number;
    hasMore?: boolean;
  };
};

export async function loadAllPages<T>(
  loadPage: (offset: number, limit: number) => Promise<ServerPage<T>>,
  pageSize = 100,
): Promise<T[]> {
  const firstPage = await loadPage(0, pageSize);
  const items = [...firstPage.items];
  let total = firstPage.page.total;
  if (!firstPage.items.length || items.length >= total) return items;

  let offset = firstPage.items.length;
  if (firstPage.items.length < pageSize) return loadRemainingSequentially(loadPage, items, offset, total, pageSize);

  const concurrency = 3;
  while (offset < total) {
    const offsets = Array.from({ length: concurrency }, (_, index) => offset + index * pageSize).filter(
      (nextOffset) => nextOffset < total,
    );
    const pages = await Promise.all(offsets.map((nextOffset) => loadPage(nextOffset, pageSize)));
    for (const page of pages) {
      if (!page.items.length) return items;
      items.push(...page.items);
      total = page.page.total;
      offset += page.items.length;
      if (offset >= total) return items;
      if (page.items.length < pageSize) return loadRemainingSequentially(loadPage, items, offset, total, pageSize);
    }
  }
  return items;
}

async function loadRemainingSequentially<T>(
  loadPage: (offset: number, limit: number) => Promise<ServerPage<T>>,
  items: T[],
  offset: number,
  total: number,
  pageSize: number,
): Promise<T[]> {
  while (offset < total) {
    const page = await loadPage(offset, pageSize);
    if (!page.items.length) return items;
    items.push(...page.items);
    total = page.page.total;
    offset += page.items.length;
  }
  return items;
}
