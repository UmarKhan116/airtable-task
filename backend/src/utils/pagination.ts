export interface PaginationOptions {
  page?: number;
  limit?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  filter?: Record<string, unknown>;
}

export interface PaginationResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export function buildPaginationOptions(query: Record<string, string>): PaginationOptions {
  const page = Math.max(1, parseInt(query['page'] ?? '1', 10));
  const limit = Math.min(1000, Math.max(1, parseInt(query['limit'] ?? '100', 10)));
  const sortField = query['sortField'] ?? '_id';
  const sortOrder = query['sortOrder'] === 'desc' ? 'desc' : 'asc';

  return { page, limit, sortField, sortOrder };
}

export function buildPaginationResult<T>(
  data: T[],
  total: number,
  options: PaginationOptions
): PaginationResult<T> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 100;
  const totalPages = Math.ceil(total / limit);

  return {
    data,
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}
