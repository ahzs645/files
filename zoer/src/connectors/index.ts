import { bidsAndTenders } from './bidsandtenders';
import { municipalSites } from './municipal-sites';
import type { SourceConnector } from './types';

/** Every listing connector `procurement.collect` can run. Append new connectors; ids are saved in sourceKeys. */
export const CONNECTORS: SourceConnector[] = [
  bidsAndTenders,
  municipalSites,
];

export const connectorById = (id: string) => CONNECTORS.find(connector => connector.id === id);
