// Source query names stay unchanged; only the Zoer build aliases the backend transport.
export const api: any = new Proxy({}, { get: (_, group: string) => new Proxy({}, { get: (_, method: string) => `${group}.${method}` }) });
