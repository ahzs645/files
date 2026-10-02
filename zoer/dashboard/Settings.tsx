import { CatalogTools } from './Catalog';

/** Zoer-only Settings section: export and import for both catalogs, moved out of the page headers. */
export function SettingsPage() {
  return <div className="bid-settings">
    <section className="zoer-history" aria-labelledby="settings-opportunities">
      <h2 id="settings-opportunities">Opportunities</h2>
      <p>Export saved opportunities or import a JSON file.</p>
      <CatalogTools entity="opportunity" />
    </section>
    <section className="zoer-history" aria-labelledby="settings-awards">
      <h2 id="settings-awards">Awards</h2>
      <p>Export saved awards, import a JSON file or resume the history download.</p>
      <CatalogTools entity="award" />
    </section>
  </div>;
}
