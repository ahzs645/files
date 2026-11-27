# Supplier participation evidence

Open the notice in Procurement and choose **Evidence → Supplier participation → Import supplier evidence**. Choose the source notice URL, then paste rendered publisher HTML or version 1 JSON. Preview the supplier tables and save the observation. The on-page JSON template starts with the selected URL and timestamp.

The bids&tenders HTML reader supports plan takers, unofficial submitted bids, awards, and meeting locations. The Bonfire reader supports public document takers and awards. Use JSON for other publishers and roles, including interested suppliers, prequalified suppliers, prime contractor interest, subcontractor interest, and local sections. A source section or field can keep its original label and declare a specific canonical role or binding. The built-in aliases supply a default for common labels.

```json
{
  "version": 1,
  "source": {
    "url": "https://example.ca/opportunities/26-031",
    "observedAt": "2026-11-26T23:00:00Z",
    "reference": "26-031"
  },
  "sections": [
    {
      "id": "response-list",
      "label": "Registered respondents",
      "role": "interested-suppliers",
      "state": "published",
      "fields": [
        { "id": "organization", "label": "Registered organization", "type": "text", "binding": "supplier" },
        { "id": "regional-lot", "label": "Regional lot", "type": "text" }
      ],
      "rows": [
        { "organization": "Example Supplier", "regional-lot": "North" }
      ]
    }
  ]
}
```

A field type can be `text`, `number`, `boolean`, `date`, `datetime`, `money`, or `url`. A monetary cell accepts the published display string or an object containing `display`, optional decimal string `decimal`, and optional three-letter `currency`. Source Date and Time cells retain the printed value. An observation timestamp must include an offset or Z. Field IDs are unique inside a section, and row keys match those IDs. For custom section labels, set `role: "custom"` and use a stable section ID across imports. Field bindings can map different source labels onto the same concept without changing the displayed heading. [Schema and bindings](../../zoer/dashboard/procurement/participation.ts)

The states are `published`, `empty`, `restricted`, `not-shown`, and `incomplete`. The card retains the last complete observation when a later source capture is restricted or incomplete. The source URL and section ID determine which observation is updated on the selected opportunity. A repeat import updates that observation. Separate submission rows from the same supplier are preserved.

The importer reads user-supplied captures and authorized JSON exports. It stores the normalized evidence in the existing catalog. It uses no publisher login or outgoing request. Scheduled extraction requires a permitted publisher source. The daily link matching and hourly public file workflows continue independently.
