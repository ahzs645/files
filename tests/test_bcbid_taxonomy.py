"""Read-only validation against BC's actual workbook; no local database/server."""
import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import importBcBidTaxonomy as taxonomy


class TaxonomyWorkbookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = pathlib.Path.home() / 'Downloads/unspsc_codes_in_bc_bid_-_aug_2023.xlsx'
        if not path.exists():
            raise unittest.SkipTest('Official source workbook is not available locally.')
        cls.terms, cls.changes, cls.release, cls.lookup = taxonomy.workbook_records(path)
        cls.by_id = {row['id']: row for row in cls.terms}

    def test_complete_parent_hierarchy_and_definitions(self):
        self.assertEqual(self.release['data']['counts'], {'segment': 58, 'family': 516, 'class': 6642, 'commodity': 82756})
        self.assertEqual(len(self.by_id), 89972)
        for row in self.terms:
            node = row['data']
            if node['parentId']:
                parent = self.by_id[node['parentId']]['data']
                self.assertEqual(node['ancestors'][-1]['code'], parent['code'])
                self.assertEqual(node['path'], parent['path'] + node['code'] + '|')
            else:
                self.assertEqual(node['level'], 'segment')
                self.assertEqual(node['ancestors'], [])
        self.assertEqual(sum(bool(row['data']['definition']) for row in self.terms), 69739)

    def test_ambiguous_labels_and_family_links_preserve_specificity(self):
        original = {'id': 'opportunity:test', 'kind': 'opportunity', 'title': 'Scope', 'data': {
            'commodities': ['Community and social services', 'Corrosion inhibitors'],
            'detailFields': [{'label': 'Main Commodity', 'value': 'Community and social services'}],
            'attachments': [{'url': 'keep.pdf'}], 'starred': True}}
        row, links = taxonomy.linked_notice(original, self.lookup, self.release)
        self.assertEqual(row['data']['classificationCodes'], ['93140000'])
        self.assertEqual(links[0]['data']['role'], 'main')
        self.assertEqual(links[0]['data']['termId'], taxonomy.term_id('93140000'))
        self.assertEqual(row['data']['commodityClassifications'][0]['level'], 'family')
        self.assertEqual(len(row['data']['commodityClassifications'][0]['ancestors']), 1)
        self.assertEqual(row['data']['commodityClassificationUnresolved'][0]['candidateCodes'], ['12163600', '12163603'])
        self.assertEqual(row['data']['attachments'], original['data']['attachments'])
        self.assertTrue(row['data']['starred'])
        self.assertNotIn('classificationLinkSet', original['data'])
        again, same_links = taxonomy.linked_notice(row, self.lookup, self.release)
        self.assertEqual(row, again)
        self.assertEqual(links, same_links)

    def test_index_resolves_to_complete_terms_and_delta_retains_old_release(self):
        indices = taxonomy.index_entries(self.lookup)
        self.assertEqual(len(indices), 256)
        for entry in indices:
            self.assertLess(len(taxonomy.encoded(entry['value'])), 1500000)
            for item in entry['value']['items']:
                for identifier in item['termIds']:
                    self.assertIn(identifier, self.by_id)
                    self.assertEqual(self.by_id[identifier]['data']['title'], item['title'])
        self.assertEqual(len(self.changes), 508)
        self.assertEqual(sum(row['data']['change_type'] == 'MOVE' for row in self.changes), 1)
        self.assertEqual(self.release['data']['previousReleaseCoverage'], 'change-log-only')


if __name__ == '__main__':
    unittest.main()
