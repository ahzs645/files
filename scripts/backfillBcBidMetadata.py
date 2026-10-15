#!/usr/bin/env python3
"""Enrich the EXISTING Zoer catalog from BC's official UNSPSC workbook.

Dry-run by default. Categories/updated commodity labels require a saved browser
capture of all three Industry Category filters. Never guesses codes/categories,
creates databases, rewrites attachments, or replaces scrape checkpoints.
Requires openpyxl for read-only workbook extraction.
"""
import argparse
import collections
import copy
import hashlib
import json
import pathlib
import urllib.request

SOURCE = 'https://www2.gov.bc.ca/assets/gov/bc-procurement-resources/unspsc_codes_in_bc_bid_-_aug_2023.xlsx?forcedownload=true'
SHEET = 'UNSPSC UNv260801'
KEY = 'procurement:bcbid:metadata-audit'


def workbook_lookup(path):
    import openpyxl
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook[SHEET]
    expected = ('Key', 'Segment', 'Segment Title', 'Family', 'Family Title', 'Class', 'Class Title', 'Commodity', 'Commodity Title', 'Definition')
    if tuple(next(sheet.iter_rows(min_row=7, max_row=7, values_only=True))) != expected:
        raise ValueError('Unexpected official workbook header; no writes made.')
    lookup = collections.defaultdict(dict)
    levels = [(1, 'segment'), (3, 'family'), (5, 'class'), (7, 'commodity')]
    for number, row in enumerate(sheet.iter_rows(min_row=8, values_only=True), 8):
        parents = []
        for index, level in levels:
            code, title = row[index:index + 2]
            if not code or not title:
                continue
            code, title = str(int(code)), str(title).strip()
            if len(code) != 8 or not code.isdigit():
                raise ValueError('Invalid UNSPSC identifier.')
            # A family/class has ancestors only, never an arbitrary child from
            # the first workbook row containing that family/class.
            item = {'code': code, 'title': title, 'level': level,
                    'ancestors': copy.deepcopy(parents), 'sourceRow': number}
            lookup[title].setdefault(code, item)
            parents.append({'code': code, 'title': title, 'level': level})
    workbook.close()
    return dict(lookup)


def source_categories(path):
    if path is None:
        return {}
    capture = json.loads(path.read_text())
    if capture.get('scope') != 'Open opportunities' or set(capture.get('completeCategories', [])) != {'Construction', 'Goods', 'Services'}:
        raise ValueError('Expected complete captures of the three Open industry-category filters.')
    rows = {}
    for item in capture['rows']:
        if (item.get('category') not in {'Construction', 'Goods', 'Services'}
                or item.get('sourceUrl') != 'https://bcbid.gov.bc.ca/page.aspx/en/rfp/request_browse_public'
                or not str(item.get('processId', '')).isdigit()
                or not isinstance(item.get('commodities'), list)
                or not item.get('capturedAt')):
            raise ValueError('Invalid browser source category evidence.')
        previous = rows.setdefault(item['processId'], {'categories': [], 'commodities': item['commodities'], 'capturedAt': item['capturedAt'], 'sourceUrl': item['sourceUrl']})
        if previous['commodities'] != item['commodities']:
            raise ValueError('Conflicting commodity captures; re-read the source.')
        if item['category'] not in previous['categories']:
            previous['categories'].append(item['category'])
    return rows


def enrich(data, lookup, provenance, categories, details=None):
    next_data = copy.deepcopy(data)
    observed = categories.get(str(data.get('processId') or data.get('sourceKey')))
    if observed:
        next_data['commodities'] = observed['commodities']
        next_data['industryCategories'] = sorted(observed['categories'])
        if len(observed['categories']) == 1:
            next_data['category'] = observed['categories'][0]
        next_data['industryCategoryProvenance'] = {
            'sourceUrl': observed['sourceUrl'], 'capturedAt': observed['capturedAt'],
            'scope': 'Open opportunities', 'method': 'source-industry-category-filter'}
    main = next((field['value'] for field in data.get('detailFields', [])
                 if field.get('label') == 'Main Commodity'), None)
    if main and not data.get('commodityTablesCaptured'):
        next_data['mainCommodity'] = main
    detail = (details or {}).get(str(data.get('processId') or data.get('sourceKey')))
    if detail and (data.get('sourceCapturedAt') or '') <= detail['capturedAt']:
        next_data['commodities'] = detail['commodities']
        next_data['mainCommodity'] = detail['mainCommodity']
        next_data['commoditySourceProvenance'] = {
            'sourceUrl': detail['sourceUrl'], 'capturedAt': detail['capturedAt'],
            'method': 'source-main-and-other-commodity-tables'}
    resolved, unresolved = [], []
    for label in next_data.get('commodities', []):
        candidates = lookup.get(label, {})
        if len(candidates) == 1:
            resolved.append({'sourceLabel': label, **next(iter(candidates.values()))})
        else:
            unresolved.append({'sourceLabel': label,
                               'reason': 'ambiguous-title' if candidates else 'no-exact-title-match',
                               'candidateCodes': sorted(candidates)})
    next_data['classificationCodes'] = sorted({item['code'] for item in resolved})
    next_data['commodityClassifications'] = resolved
    next_data['commodityClassificationUnresolved'] = unresolved
    next_data['commodityClassificationProvenance'] = provenance
    return next_data


def validate_detail_capture(path):
    details = {}
    for item in json.loads(path.read_text())['rows']:
        process = str(item.get('processId', ''))
        if (not process.isdigit() or item.get('sourceUrl') != 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/' + process
                or not item.get('capturedAt') or not item.get('mainCommodity')
                or not isinstance(item.get('commodities'), list) or item['mainCommodity'] not in item['commodities']):
            raise ValueError('Invalid source commodity detail evidence.')
        if process in details:
            raise ValueError('Duplicate source commodity detail evidence.')
        details[process] = item
    return details


def run(args):
    base = args.base.rstrip('/') + '/api/databases/catalogs/bc-bid-monitor'
    if not base.startswith('https://'):
        raise ValueError('Use the existing HTTPS Zoer deployment.')
    def call(route, body):
        request = urllib.request.Request(base + route, data=json.dumps(body).encode(),
                                         headers={'Content-Type': 'application/json'})
        return json.load(urllib.request.urlopen(request, timeout=30))
    lookup = workbook_lookup(args.workbook)
    categories = source_categories(args.categories)
    details = validate_detail_capture(args.commodity_details) if args.commodity_details else {}
    provenance = {'system': 'UNSPSC', 'version': 'UNv260801', 'sourceUrl': SOURCE,
                  'sourceSha256': hashlib.sha256(args.workbook.read_bytes()).hexdigest(),
                  'sheet': SHEET, 'method': 'unique-exact-title-match'}
    # Bounded cursor discovery; the catalog console caps each response at 200.
    ids, after = [], ''
    for _ in range(100):
        page = call('/query', {'statement': "SELECT id FROM records WHERE kind=? AND json_extract(data,'$.detailUrl') LIKE ? AND id>? ORDER BY id LIMIT 200",
                               'parameters': ['opportunity', 'https://bcbid.gov.bc.ca/%', after]})['rows']
        if not page:
            break
        cursor = page[-1]['id']
        if cursor <= after:
            raise ValueError('Catalog cursor failed to advance.')
        ids.extend(row['id'] for row in page)
        after = cursor
    else:
        raise ValueError('Discovery exceeded its bounded page limit.')
    stats = {'records': len(ids), 'changed': 0, 'withCodes': 0, 'fullyResolved': 0,
             'sourceCategories': 0, 'refreshedCommodityLabels': 0, 'unresolvedLabels': []}
    unresolved = set()
    before_images, receipts = [], []
    for offset in range(0, len(ids), 25):
        batch_ids = ids[offset:offset + 25]
        # A conflict re-reads/merges current rows; never clobber concurrent stars,
        # attachments, detail capture, or newer source commodity labels.
        for attempt in range(5):
            snapshot = call('/read', {'ids': batch_ids})
            if not snapshot['primary']:
                raise ValueError('Existing primary catalog required.')
            updates, batch_stats = [], collections.Counter()
            batch_unresolved = set()
            originals = []
            for record in snapshot['records']:
                data = record['data']
                if not (data.get('detailUrl') or '').startswith('https://bcbid.gov.bc.ca/'):
                    raise ValueError('Record source changed during discovery.')
                # Ignore an older listing observation if a newer scrape arrived.
                applicable = categories
                observed = categories.get(str(data.get('processId') or data.get('sourceKey')))
                if observed and (data.get('sourceCapturedAt') or '') > observed['capturedAt']:
                    applicable = {}
                new_data = enrich(data, lookup, provenance, applicable, details)
                batch_stats['withCodes'] += bool(new_data['classificationCodes'])
                batch_stats['fullyResolved'] += bool(new_data.get('commodities')) and not new_data['commodityClassificationUnresolved']
                batch_stats['sourceCategories'] += bool(new_data.get('industryCategoryProvenance'))
                batch_stats['refreshedCommodityLabels'] += data.get('commodities') != new_data.get('commodities')
                batch_unresolved.update(item['sourceLabel'] for item in new_data['commodityClassificationUnresolved'])
                if new_data != data:
                    originals.append(record)
                    updates.append({'id': record['id'], 'kind': record['kind'], 'title': record['title'], 'data': new_data})
            if args.apply and updates:
                args.output.mkdir(parents=True, exist_ok=True)
                # Retain the baseline even if the commit response/read-back is
                # interrupted. Each optimistic attempt has a distinct file.
                (args.output / f'before-batch-{offset}-{attempt}.json').write_text(json.dumps(originals))
                receipt = call('/commit', {'revision': snapshot['revision'], 'records': updates})
                if receipt.get('conflict'):
                    continue
                receipts.append(receipt)
                saved = {row['id']: row['data'] for row in call('/read', {'ids': [r['id'] for r in updates]})['records']}
                for record in updates:
                    if saved.get(record['id']) != record['data']:
                        raise ValueError('Saved metadata read-back differs; stop and inspect concurrent changes.')
                before_images.extend(originals)
                # Persist verified receipts as each batch finishes.
                args.output.mkdir(parents=True, exist_ok=True)
                (args.output / 'before-images.json').write_text(json.dumps(before_images))
                (args.output / 'commit-receipts.json').write_text(json.dumps(receipts, indent=2))
            stats['changed'] += len(updates)
            for key, value in batch_stats.items():
                stats[key] += value
            unresolved.update(batch_unresolved)
            print(json.dumps({'processed': offset + len(batch_ids), 'of': len(ids), 'apply': args.apply}), flush=True)
            break
        else:
            raise ValueError('Repeated concurrent catalog revisions; stop safely.')
    stats['unresolvedLabels'] = sorted(unresolved)
    report = {'applied': args.apply, 'provenance': provenance, 'stats': stats,
              'categoryScope': 'Current Open source listing only; older/closed categories remain unverified.'}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / ('applied.json' if args.apply else 'plan.json')).write_text(json.dumps(report, indent=2))
    if args.apply:
        for _ in range(5):
            head = call('/read', {'ids': []})
            result = call('/commit', {'revision': head['revision'], 'entries': [{'key': KEY, 'value': report}]})
            if not result.get('conflict'):
                readback = call('/workspace', {'keys': [KEY]})
                if readback['entries'][0]['value'] != report:
                    raise ValueError('Audit receipt read-back failed.')
                break
        else:
            raise ValueError('Could not save final audit receipt.')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='https://zoer.k8s.overtheedgepaper.ca')
    parser.add_argument('--workbook', type=pathlib.Path, required=True)
    parser.add_argument('--categories', type=pathlib.Path)
    parser.add_argument('--commodity-details', type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--apply', action='store_true')
    run(parser.parse_args())
