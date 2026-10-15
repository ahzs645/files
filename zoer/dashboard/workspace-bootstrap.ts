/** Read bounded run metadata concurrently; the bridge still caps actual requests at four. */
export async function readWorkspaceMetadata(host: (method: string, input?: unknown) => Promise<any>, keys: string[]) {
  const pages = await Promise.all(Array.from({ length: Math.ceil(keys.length / 20) }, (_, i) =>
    host('catalog.workspace', { keys: keys.slice(i * 20, i * 20 + 20) })));
  return pages.flatMap(page => page.entries);
}
