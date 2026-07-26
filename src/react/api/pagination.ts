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
  const items: T[] = [];
  let offset = 0;
  let total = 0;

  do {
    const response = await loadPage(offset, pageSize);
    items.push(...response.items);
    total = response.page.total;
    offset += response.items.length;
    if (!response.items.length) break;
  } while (offset < total);

  return items;
}
