export interface PageMeta {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

export interface PagedResponse<T> {
  items: T[];
  page: PageMeta;
}
