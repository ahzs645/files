import { noTextMessage } from './ai';

/** What the notice's text preview shows for a saved file without text: waiting for extraction, or read and empty. */
export function NoText({ doc }: { doc: any }) {
  return <p className="pc-card pc-card-empty">{noTextMessage(doc)}</p>;
}
