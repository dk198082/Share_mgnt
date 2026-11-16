"""Offline tests of review artifacts and hand-authored synthetic examples only.

These are NOT tests of a production importer: that implementation is intentionally
paused. No application modules, credentials, DB clients, or network tools are used.
"""
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
import json
import tempfile
import unittest

from openpyxl import Workbook, load_workbook

from build_review import DOCS, FIELDS, build, disposition, literal, source_bindings
from profile_sources import assess
from review_spec import alias_for, synthetic_data


def check_synthetic_fixture(data):
    """Assert the example is internally linked, not a production validation API."""
    owner_ids = {r["legacy_shareholder_id"] for r in data["Shareholders"]}
    certs = {r["certificate_id"]: r for r in data["Certificates"]}
    assert len(certs) == len(data["Certificates"])
    transfers = {r["legacy_transfer_id"]: r for r in data["Transfers"]}
    allocated = {}
    incoming = set()
    for cert in certs.values():
        assert cert["owner_legacy_id"] in owner_ids
        assert cert["certificate_id"].startswith("C-" if cert["share_class"] == "Common" else "P-")
        original = Decimal(cert["original_quantity"])
        outstanding = Decimal(cert["outstanding_quantity"])
        moved = Decimal(cert["verified_transferred_quantity"])
        assert original > 0 and outstanding >= 0 and moved >= 0
        assert original == outstanding + moved + Decimal(cert["cancelled_quantity"]) + Decimal(cert["repurchased_quantity"])
        assert cert["issue_date"] <= data["Import_Run"][0]["cutoff_date"]
    for allocation in data["Transfer_Allocations"]:
        transfer = transfers[allocation["legacy_transfer_id"]]
        source = certs[allocation["source_certificate_id"]]
        assert source["owner_legacy_id"] == transfer["source_owner_legacy_id"]
        assert source["share_class"] == transfer["share_class"]
        assert source["issue_date"] <= transfer["transfer_date"]
        key = (transfer["legacy_transfer_id"], source["certificate_id"])
        assert key not in allocated
        allocated[key] = Decimal(allocation["quantity"])
        assert allocated[key] > 0
    for tid, transfer in transfers.items():
        recipient = certs[transfer["recipient_certificate_id"]]
        assert recipient["certificate_id"] not in incoming
        incoming.add(recipient["certificate_id"])
        assert transfer["source_owner_legacy_id"] != transfer["recipient_owner_legacy_id"]
        assert recipient["owner_legacy_id"] == transfer["recipient_owner_legacy_id"]
        assert recipient["share_class"] == transfer["share_class"]
        assert sum(qty for (t, _), qty in allocated.items() if t == tid) == Decimal(transfer["quantity"])
        assert Decimal(recipient["original_quantity"]) == Decimal(transfer["quantity"])
        assert recipient["issue_date"] == transfer["transfer_date"]
    for cid, cert in certs.items():
        assert sum(qty for (_, source), qty in allocated.items() if source == cid) == Decimal(cert["verified_transferred_quantity"])
    for control in data["Reconciliation"]:
        matching = [c for c in certs.values() if c["share_class"] == control["share_class"]]
        assert sum(Decimal(c["outstanding_quantity"]) for c in matching) == Decimal(control["expected_outstanding"])
        assert len(matching) == int(control["expected_certificate_count"])


class ReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.output = build(Path(cls.temp.name))

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_blank_templates_have_no_records_and_match_dictionary(self):
        wb = load_workbook(self.output / "Legacy_Import_Templates_DRAFT.xlsx")
        for sheet, fields in FIELDS.items():
            ws = wb[sheet]
            self.assertEqual([c.value for c in ws[1]], [f["field"] for f in fields])
            self.assertTrue(all(c.value is None for row in ws.iter_rows(min_row=2) for c in row))
            self.assertEqual(ws.freeze_panes, "A2")
            for column in range(1, len(fields) + 1):
                self.assertEqual(ws.cell(2, column).number_format, "@")
                self.assertIsNotNone(ws.cell(1, column).comment)
        self.assertEqual(wb["Field Definitions"].max_row - 1, sum(map(len, FIELDS.values())))
        self.assertGreater(len(wb["Certificates"].data_validations.dataValidation), 0)
        wb.close()

    def test_all_generated_cells_are_literal_and_no_external_links(self):
        for path in self.output.glob("*.xlsx"):
            wb = load_workbook(path, read_only=True, data_only=False)
            for ws in wb:
                for row in ws.iter_rows():
                    self.assertTrue(all(c.data_type != "f" for c in row))
            self.assertFalse(wb._external_links)
            wb.close()

    def test_formula_injection_is_literal(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "safety.xlsx"
            wb = Workbook()
            values = ["=1+1", "+SUM(A1:A2)", "-1+2", "@SUM(A1:A2)", "\t=1+1", "\r=1+1"]
            for i, value in enumerate(values, 1):
                literal(wb.active, i, 1, value)
            wb.save(path)
            reopened = load_workbook(path)
            for i, value in enumerate(values, 1):
                self.assertEqual(reopened.active.cell(i, 1).value, value.replace("\r", "\n"))
                self.assertEqual(reopened.active.cell(i, 1).data_type, "s")
            reopened.close()

    def test_every_discovered_header_has_disposition(self):
        assessment = json.loads((DOCS / "source-assessment.json").read_text())
        wb = load_workbook(self.output / "Legacy_Import_Mapping_Review.xlsx", read_only=True)
        expected = sum(len(s["columns"]) for f in assessment["files"] for s in f["sheets"])
        self.assertEqual(wb["Source Columns"].max_row - 1, expected)
        self.assertEqual(wb["Conversion Rules"].max_row - 1, 22)
        self.assertEqual(wb["Decisions"].max_row - 1, 10)
        self.assertEqual(wb["Decisions"]["E2"].value, "Confirmed: up to 2 decimal places")
        self.assertEqual(wb["Findings"].max_row - 1, 8)
        for file in assessment["files"]:
            alias, _ = alias_for(file["file"])
            for sheet in file["sheets"]:
                for column in sheet["columns"]:
                    state, rule = disposition(alias, sheet["sheet"], column["name"], source_bindings())
                    self.assertTrue(state and rule)
        wb.close()

    def test_fixture_is_consistent_and_wholly_synthetic(self):
        data = synthetic_data()
        check_synthetic_fixture(data)
        for person in data["Shareholders"]:
            self.assertTrue(person["name"].startswith("Synthetic Holder "))
            self.assertTrue(person["email"].endswith("@example.test"))
            self.assertFalse(person.get("ssn"))
        self.assertEqual(data["Documents"], [])
        self.assertEqual(len(data["Transfers"]), 2)
        self.assertEqual(len(data["Transfer_Allocations"]), 3)

    def test_fixture_checks_catch_missing_owner_and_bad_allocations(self):
        broken = deepcopy(synthetic_data())
        broken["Certificates"][0]["owner_legacy_id"] = "SYN-MISSING"
        with self.assertRaises(AssertionError):
            check_synthetic_fixture(broken)
        broken = deepcopy(synthetic_data())
        broken["Transfer_Allocations"][0]["quantity"] = "61"
        with self.assertRaises(AssertionError):
            check_synthetic_fixture(broken)

    def test_examples_in_workbook_equal_synthetic_spec(self):
        wb = load_workbook(self.output / "Legacy_Import_Synthetic_Example.xlsx", read_only=True)
        for sheet, rows in synthetic_data().items():
            fields = [f["field"] for f in FIELDS[sheet]]
            values = [
                dict(zip(fields, row)) for row in wb[sheet].iter_rows(min_row=2, values_only=True)
                if any(v is not None for v in row)
            ]
            self.assertEqual(len(values), len(rows))
            for expected, actual in zip(rows, values):
                self.assertTrue(all(actual[k] == v for k, v in expected.items()))
        wb.close()

    def test_standalone_document_is_self_contained_and_has_gate(self):
        text = (self.output / "Legacy_Import_Design_Review.html").read_text()
        self.assertIn("DRAFT", text)
        self.assertIn("Real-data importing is blocked on Replit", text)
        self.assertNotIn("<script", text.lower())
        self.assertNotIn('src="http', text)
        self.assertNotIn('href="http', text)
        self.assertIn("Fractional shares", text)
        self.assertIn("R22", text)

    def test_profiler_emits_no_personal_row_values(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "synthetic.xlsx"
            wb = Workbook()
            ws = wb.active
            ws.title = "Stakeholders"
            ws.append(["SYNTHETIC export heading"])
            ws.append(["DO NOT EMIT THIS HEADING"])
            ws.append([])
            ws.append(["Name", "Email"])
            ws.append(["SYNTHETIC SECRET TEST VALUE", "do-not-emit@example.test"])
            wb.save(path)
            result = json.dumps(assess(path))
            self.assertNotIn("SYNTHETIC SECRET", result)
            self.assertNotIn("do-not-emit", result)
            self.assertNotIn("DO NOT EMIT", result)
            self.assertIn('"populated_rows_below_header": 1', result)


if __name__ == "__main__":
    unittest.main()
