"""Read-only workbook structure/aggregate assessment. Never emits personal cell values.

This is design tooling, not an importer. It has no database or network access.
Run only against approved anonymized examples, never real production extracts.
"""
from __future__ import annotations

import argparse
from collections import Counter
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path

from openpyxl import load_workbook


def populated(row):
    return any(v not in (None, "") for v in row)


def header_row(sheet_name):
    if sheet_name == "Grants Outstanding Canceled":
        return 15
    if sheet_name == "Securities Granted":
        return 14
    if sheet_name in {
        "Company", "Securities", "Convertibles", "StakeholderCompanies",
        "ShareClasses", "EquityPlan", "Custom Report",
    }:
        return 2
    return 4


def records(sheet):
    rows = list(sheet.iter_rows(values_only=True))
    offset = header_row(sheet.title)
    if len(rows) < offset:
        return []
    headers = rows[offset - 1]
    return [
        {str(k): v for k, v in zip(headers, row) if k not in (None, "")}
        for row in rows[offset:] if populated(row)
    ]


def dec(value):
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def assess(path):
    wb = load_workbook(path, read_only=True, data_only=False)
    cached = load_workbook(path, read_only=True, data_only=True)
    result = {
        "file": path.name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "sheets": [],
    }
    for ws in wb:
        rows = list(ws.iter_rows(values_only=True))
        offset = header_row(ws.title)
        labels = [
            {"column": i + 1, "name": str(v)}
            for i, v in enumerate(rows[offset - 1]) if v not in (None, "")
        ]
        formula_count = 0
        missing_cache = 0
        # Iterate paired streams rather than random-accessing the cached read-only sheet.
        for formula_row, cache_row in zip(ws.iter_rows(), cached[ws.title].iter_rows()):
            for cell, cache_cell in zip(formula_row, cache_row):
                if cell.data_type == "f":
                    formula_count += 1
                    if cache_cell.value is None:
                        missing_cache += 1
        result["sheets"].append({
            "sheet": ws.title, "visibility": ws.sheet_state,
            "header_row": offset, "columns": labels,
            "populated_rows_below_header": sum(populated(row) for row in rows[offset:]),
            "formula_cells": formula_count, "formula_cells_without_cache": missing_cache,
            "note": "Rows below header may include totals/subheadings; not necessarily entity counts.",
        })
    if "Securities" in wb.sheetnames and "StakeholderCompanies" in wb.sheetnames:
        securities = records(wb["Securities"])
        owners = records(wb["StakeholderCompanies"])
        classes = records(wb["ShareClasses"])
        owner_ids = {str(row.get("Id")) for row in owners}
        ids = {str(row.get("Id")) for row in securities}
        classes_by_id = {str(row.get("Id")): str(row.get("Name")) for row in classes}
        parents = [
            str(row.get("TransferredFrom")) for row in securities
            if row.get("TransferredFrom") not in (None, "", 0, "0")
        ]
        cert_counts = Counter(str(r.get("CertificateId")) for r in securities)
        quantities = {}
        for field in ["IssuedAmount", "OutstandingAmount", "CancelledAmount"]:
            values = [dec(row.get(field)) for row in securities]
            valid = [v for v in values if v is not None]
            quantities[field] = {
                "sum": str(sum(valid)),
                "fractional_rows": sum(v != v.to_integral_value() for v in valid),
            }
        result["raw_assessment"] = {
            "security_rows": len(securities), "shareholder_rows": len(owners),
            "unique_owner_references": len({str(r.get("StakeholderId")) for r in securities}),
            "unresolved_owner_rows": sum(str(r.get("StakeholderId")) not in owner_ids for r in securities),
            "duplicate_certificate_groups": sum(n > 1 for n in cert_counts.values()),
            "duplicate_certificate_extra_rows": sum(n - 1 for n in cert_counts.values() if n > 1),
            "status_counts": dict(Counter(str(r.get("Status")) for r in securities)),
            "acceptance_status_counts": dict(Counter(str(r.get("AcceptanceStatus")) for r in securities)),
            "parent_link_rows": len(parents),
            "unresolved_parent_rows": sum(parent not in ids for parent in parents),
            "quantity_assessment": quantities,
            "class_totals": [
                {
                    "class": classes_by_id.get(str(c.get("Id")), "UNSUPPORTED"),
                    "class_outstanding": str(c.get("OutstandingAmount")),
                    "security_outstanding_sum": str(sum(
                        dec(s.get("OutstandingAmount")) or Decimal(0)
                        for s in securities if str(s.get("SecurityClassId")) == str(c.get("Id"))
                    )),
                } for c in classes
            ],
        }
    wb.close()
    cached.close()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("files", nargs="+", type=Path)
    args = parser.parse_args()
    report = {
        "purpose": "Design only: structures and aggregates, no personal row values",
        "files": [assess(p) for p in sorted(args.files)],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Assessed {len(report['files'])} files; wrote structures and aggregate counts only.")


if __name__ == "__main__":
    main()
