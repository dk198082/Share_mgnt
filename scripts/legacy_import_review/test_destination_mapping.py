"""Offline checks of destination documentation; never accesses application data."""
import json
from pathlib import Path
import tempfile
import unittest

from openpyxl import load_workbook

from build_review import DOCS
from destination_mapping import (
    CORE_SHEETS, CORE_TABLES, TABLES, build_destination, column_rows,
    json_rows, shareholder_rows, supporting_rows,
)


class DestinationMappingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temp.name)
        cls.catalog = json.loads((DOCS / "destination-schema.json").read_text())
        build_destination(cls.output, cls.output)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_every_table_and_column_is_listed_once(self):
        self.assertEqual(len(TABLES), 18)
        expected = {(t["name"], c["name"]) for t in self.catalog["tables"] for c in t["columns"].values()}
        rows = column_rows(self.catalog)
        self.assertEqual(len(rows), 162)
        self.assertEqual({(r[0], r[1]) for r in rows}, expected)
        self.assertEqual(len(rows), len(expected))
        self.assertTrue(all(r[6] and r[7] and r[8] and r[9] for r in rows))

    def test_db_nullability_and_defaults_match_declared_schema(self):
        rows = {(r[0], r[1]): r for r in column_rows(self.catalog)}
        for table in self.catalog["tables"]:
            for col in table["columns"].values():
                row = rows[table["name"], col["name"]]
                self.assertEqual(row[4], "NOT NULL" if col["notNull"] else "NULL allowed")
                if "default" in col:
                    self.assertEqual(row[5], str(col["default"]))

    def test_operational_records_do_not_require_pulley_data(self):
        rows = column_rows(self.catalog)
        for table in ["sessions", "users", "transfer_requests", "certificate_request_templates",
                      "signoff_email_notifications", "signoff_result_email_notifications"]:
            self.assertTrue(all(r[6] == "Not imported" for r in rows if r[0] == table))

    def test_source_required_is_not_confused_with_not_null(self):
        rows = {(r[0], r[1]): r for r in column_rows(self.catalog)}
        self.assertEqual(rows["shareholders", "id"][4], "NOT NULL")
        self.assertIn("utility supplies", rows["shareholders", "id"][7])
        self.assertEqual(rows["certificates", "quantity"][6], "Required from source")
        self.assertEqual(rows["certificates", "quantity"][7], "No")
        self.assertEqual(rows["certificates", "issue_date"][4], "NULL allowed")
        self.assertIn("Conditional", rows["share_transfers", "sources"][6])
        self.assertIn("schema gap", rows["certificate_documents", "template_id"][6])

    def test_shareholder_detail_and_json_coverage(self):
        details = shareholder_rows()
        self.assertEqual([r[1] for r in details if r[2] == "Required"], ["data.name"])
        self.assertIn("data.generationNumber", {r[1] for r in details})
        self.assertIn("data.documents[]", {r[1] for r in details})
        self.assertIn("ssn_encrypted / ssn_last4", {r[1] for r in details})
        expected = {(t["name"], c["name"]) for t in self.catalog["tables"]
                    for c in t["columns"].values() if c["type"] == "jsonb"}
        self.assertEqual({tuple(r[:2]) for r in json_rows(self.catalog)}, expected)

    def test_fractional_requirement_covers_both_classes_without_claiming_live_support(self):
        md = (self.output / "destination-first-mapping.md").read_text()
        self.assertIn("both Common and Preferred must support fractional shares", md)
        self.assertIn("quantities below one share", md)
        self.assertIn("2 decimal places", md)
        self.assertIn("must be applied before fractional production writes", md)
        rows = {(r[0], r[1]): r for r in column_rows(self.catalog)}
        self.assertIn("Fractional Common and Preferred", rows["certificates", "quantity"][9])
        self.assertIn("Common or Preferred", rows["share_transfers", "quantity"][9])

    def test_workbook_and_document_are_complete_and_safe(self):
        wb = load_workbook(self.output / "Shareholder_App_Table_Field_Mapping.xlsx", read_only=True)
        self.assertEqual(wb.sheetnames, ["Start Here", *CORE_SHEETS, "Other Tables", "Source Guide"])
        self.assertEqual(wb["Other Tables"].max_row - 1, 15)
        self.assertEqual(wb["Source Guide"].max_row - 1, 9)
        for ws in wb:
            for row in ws:
                self.assertTrue(all(c.data_type != "f" for c in row))
        wb.close()
        md = (self.output / "destination-first-mapping.md").read_text()
        for table in TABLES:
            self.assertIn(("## " if table in CORE_TABLES else "### ") + table + "\n", md)
        self.assertIn("No full anonymized dataset", md)
        html = (self.output / "Shareholder_App_Table_Field_Mapping.html").read_text()
        self.assertNotIn("<script", html.lower())
        self.assertIn("162 database columns", html)

    def test_primary_tabs_keep_every_core_field_and_no_operational_fields(self):
        wb = load_workbook(self.output / "Shareholder_App_Table_Field_Mapping.xlsx", read_only=True)
        actual = set()
        for table, title in zip(CORE_TABLES, CORE_SHEETS):
            for row in wb[title].iter_rows(min_row=2, values_only=True):
                self.assertEqual(row[0], table)
                self.assertTrue(all(row[i] for i in (1, 2, 4, 6, 7, 8, 9)))
                if row[2] != "JSON profile property":
                    actual.add((row[0], row[1]))
        expected = {(t["name"], c["name"]) for t in self.catalog["tables"]
                    if t["name"] in CORE_TABLES for c in t["columns"].values()}
        self.assertEqual(actual, expected)
        wb.close()

    def test_shareholder_profile_is_in_primary_tab_with_review_cells(self):
        wb = load_workbook(self.output / "Shareholder_App_Table_Field_Mapping.xlsx")
        rows = {r[1].value: r for r in wb["Shareholders"].iter_rows(min_row=2)}
        self.assertEqual(rows["data.name"][6].value, "Required")
        self.assertEqual(rows["data.email"][7].value, "Yes")
        self.assertIn("data.generationNumber", rows)
        self.assertIn("data.documents[]", rows)
        self.assertIn("ssn_encrypted", rows)
        for title in CORE_SHEETS:
            self.assertEqual(wb[title].freeze_panes, "C2")
            for row in wb[title].iter_rows(min_row=2):
                self.assertIsNone(row[10].value)
                self.assertIsNone(row[11].value)
                self.assertEqual(row[10].fill.fgColor.rgb, "00FFF2CC")
                self.assertEqual(row[11].fill.fgColor.rgb, "00FFF2CC")
        wb.close()

    def test_supporting_summary_has_exactly_fifteen_classified_tables(self):
        rows = supporting_rows(self.catalog)
        self.assertEqual({r[0] for r in rows}, set(TABLES) - set(CORE_TABLES))
        self.assertEqual(len(rows), 15)
        self.assertEqual({r[1] for r in rows}, {"Configured", "Generated", "Not imported"})
        by_name = {r[0]: r for r in rows}
        self.assertEqual(by_name["signoffs"][1], "Configured")
        self.assertEqual(by_name["certificate_counters"][1], "Generated")
        self.assertEqual(by_name["transfer_requests"][1], "Not imported")
        self.assertIn("import-aware", by_name["certificate_documents"][3])


if __name__ == "__main__":
    unittest.main()
