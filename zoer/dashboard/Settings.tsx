import { CatalogTools } from './Catalog';

/** Zoer-only Settings section: export and import for both catalogs, moved out of the page headers. */
export function SettingsPage() {
  return <div className="bid-settings">
    <section className="zoer-history" aria-labelledby="settings-opportunities">
      <h2 id="settings-opportunities">Opportunities · export & import</h2>
      <p>Download every saved opportunity (or only starred ones) as CSV or JSON, or merge an opportunity JSON file into the database. Exports include captured attachment links.</p>
      <CatalogTools entity="opportunity" />
    </section>
    <section className="zoer-history" aria-labelledby="settings-awards">
      <h2 id="settings-awards">Contract awards · export, import & history</h2>
      <p>Download saved awards as CSV or JSON, import an award JSON file, or manage the public award history download. Exports are complete record sets, independent of the current page and filters.</p>
      <CatalogTools entity="award" />
    </section>
  </div>;
}
