// The portal's own pages for reading the book. Plain functions, so client
// components can link to the book as well as server ones.

export const bookHref = {
  search: (q: string, chapter?: string | null) => `/library?${new URLSearchParams({ q, ...(chapter ? { chapter } : {}) })}`,
  page: (page: number) => `/library?page=${page}#p${page}`,
  pdf: (page?: number) => (page ? `/library/pdf?page=${page}` : "/library/pdf"),
};
