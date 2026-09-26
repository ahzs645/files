import { CatalogTools } from './Catalog';

/** Zoer-only Settings section: export and import for both catalogs, moved out of the page headers. */
export function SettingsPage() {
  return <div className="bid-settings">
    <section className="zoer-history" aria-labelledby="settings-opportunities">
      <h2 id="settings-opportunities">Opportunities</h2>
      <p>Download all saved opportunities (or starred ones), or import an opportunity JSON file.</p>
      <CatalogTools entity="opportunity" />
    </section>
    <section className="zoer-history" aria-labelledby="settings-awards">
      <h2 id="settings-awards">Awards</h2>
      <p>Download all saved awards, import an award JSON file, or continue the award history download.</p>
      <CatalogTools entity="award" />
    </section>
  </div>;
}
