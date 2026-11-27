import { PluginLink } from '../procurement/links';
import { useOverviewStatus } from '../procurement/overview-hooks';
import { plural } from '../format';

/**
 * Home's only operations content: one line, on every width, shown only when something needs the person. The count is
 * Operations › Overview's own "Needs you" count, so the two never disagree. Render it only on hosts with `collection`.
 */
export function OperationsLine() {
  const { overview } = useOverviewStatus(), count = overview.needs.length;
  if (!count) return null;
  return <p className="rw-ops-line"><PluginLink to="/status" className="rw-ops-link">{`Operations: ${plural(count, 'thing needs', 'things need')} you →`}</PluginLink></p>;
}
