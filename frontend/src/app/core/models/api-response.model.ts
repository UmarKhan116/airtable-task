export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface CollectionInfo {
  name: string;
  count: number;
}

export interface FieldSchema {
  field: string;
  types: string[];
  primaryType: string;
}

export interface CollectionSchema {
  collection: string;
  fields: FieldSchema[];
}
