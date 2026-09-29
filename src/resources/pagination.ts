/** The API's maximum page size. */
export const MAX_PAGE_SIZE = 250;

/**
 * Walks `offset` forward one page at a time, yielding every item, and stops
 * at the first page shorter than `pageSize`.
 */
export async function* paginate<T>(
  fetchPage: (limit: number, offset: number) => Promise<T[]>,
  pageSize: number = MAX_PAGE_SIZE,
): AsyncGenerator<T, void, undefined> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new RangeError(`pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}, got ${pageSize}`);
  }

  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(pageSize, offset);
    yield* page;
    if (page.length < pageSize) return;
  }
}
