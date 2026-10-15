export function paginationWindow(total: number, requestedPage: number, requestedSize: number) {
  const size = Math.max(1, Math.floor(requestedSize) || 10);
  const count = Math.max(0, Math.floor(total) || 0);
  const pages = Math.max(1, Math.ceil(count / size));
  const page = Math.min(pages, Math.max(1, Math.floor(requestedPage) || 1));
  const start = (page - 1) * size;
  return { page, pages, size, start, end: Math.min(start + size, count), total: count };
}
