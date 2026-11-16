"""Generate review documents and synthetic/blank templates; never imports records."""
from __future__ import annotations

import argparse
from html import escape
import json
from math import ceil
from pathlib import Path
import re

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from review_spec import FIELDS, alias_for, synthetic_data

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs" / "legacy-import"
OUTPUT = ROOT / "generated-artifacts" / "legacy-import-review"
GREEN = "1D3B2C"
YELLOW = "FFF2CC"


def literal(ws, row, column, value):
    """Never let source labels or error text become spreadsheet formulas."""
    if isinstance(value, str):
        # XML/Excel normalize carriage returns; make that normalization explicit.
        value = value.replace("\r\n", "\n").replace("\r", "\n")
    cell = ws.cell(row, column, value)
    if isinstance(value, str):
        cell.data_type = "s"
    return cell


def rowsheet(wb, title, headers, rows, widths=None):
    ws = wb.create_sheet(title)
    for i, header in enumerate(headers, 1):
        cell = literal(ws, 1, i, header)
        cell.fill = PatternFill("solid", fgColor=GREEN)
        cell.font = Font(color="FFFFFF", bold=True)
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    for r, row in enumerate(rows, 2):
        line_count = 1
        for c, value in enumerate(row, 1):
            cell = literal(ws, r, c, value)
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            width = (widths or {}).get(c, 30)
            line_count = max(line_count, sum(
                max(1, ceil(len(line) / max(10, width - 5)))
                for line in str(value or "").split("\n")
            ))
        ws.row_dimensions[r].height = min(240, max(30, 16 * line_count + 8))
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    ws.row_dimensions[1].height = 36
    for i in range(1, len(headers) + 1):
        ws.column_dimensions[get_column_letter(i)].width = (widths or {}).get(i, 30)
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_title_rows = "1:1"
    return ws


def newbook():
    wb = Workbook()
    wb.remove(wb.active)
    wb.properties.creator = "Shareholder Management"
    wb.properties.title = "Legacy Import - Proposed Review Only"
    wb.properties.description = "Synthetic/structural design material; not approved for production execution."
    return wb


def field_rows():
    return [
        [sheet, f["field"], f["required"], f["format"], f["destination"],
         f["source"], f["rule"], f["synthetic_example"], f["approval"]]
        for sheet, fields in FIELDS.items() for f in fields
    ]


FIELD_HEADERS = ["Template Sheet", "Field", "Required", "Format", "Destination / Gap",
                 "Source", "Conversion / Validation", "Synthetic Example", "Review Status"]


def make_template(path, examples=False):
    wb = newbook()
    rowsheet(wb, "Read Me", ["Topic", "Instructions"], [
        ["Status", "DRAFT - mapping review only. No production import is authorized."],
        ["Purpose", "Synthetic linked example" if examples else "Blank fallback/long-term template; no records included."],
        ["Boundary", "Use synthetic data in Replit. Real files enter only the verified Azure-hosted utility; retain originals in SharePoint."],
        ["Authorization", "No UI/importer exists yet. Workbook review fields do not authorize reset or commit."],
        ["Data entry", "Keep header names unchanged. IDs, quantities, dates and money are text; preserve leading zeros. Use ISO dates."],
        ["Required", "Yellow headers mark required or conditional fields. Read Field Definitions before entry. Conditional sheets can be empty."],
        ["Quantities", "Fractional Common and Preferred shares are valid, including below one share, with up to 2 decimal places. Reject excess precision. Azure quantity migration/release remains separate from this template."],
        ["Dates", "YYYY-MM-DD; no Excel formulas, ambiguous locale dates or invented timestamps."],
        ["Missing values", "Blank = unknown/not supplied, not zero. Unknown birth, passing, family line, actors and prices stay blank."],
        ["Files", "Documents is a manifest, not an upload. No original file bytes are included. Identity_Links/Documents have no synthetic rows."],
        ["SSN", "Blank in these templates/examples. Never use real SSNs in Replit or put SSNs in notes, receipts or logs."],
        ["Review", "Approve mapping, history scope and exception rules first. Reset and production import each require separate approval."],
        ["Synthetic controls", "If using the example: 3 holders, 7 certificates, 2 transfers, 3 allocations. Ending Common=142, Preferred=25." if examples else "Use the separately supplied Synthetic Example workbook for examples."],
        ["Limits", "Validation lists are entry aids, not a production validator. Full cross-record, date, precision and authorization checks are deferred."],
    ], {1: 26, 2: 115})
    data = synthetic_data() if examples else {}
    for name, fields in FIELDS.items():
        values = data.get(name, [])
        ws = rowsheet(wb, name, [f["field"] for f in fields],
                      [[v.get(f["field"], "") for f in fields] for v in values])
        for c, f in enumerate(fields, 1):
            ws.cell(1, c).comment = Comment(
                "\n".join(f"{key}: {f[key]}" for key in ["required", "format", "destination", "source", "rule"]),
                "Shareholder Management",
            )
            if f["required"] not in ("Optional", "Optional protected"):
                ws.cell(1, c).fill = PatternFill("solid", fgColor=YELLOW)
                ws.cell(1, c).font = Font(color=GREEN, bold=True)
            for r in range(2, 1002):
                ws.cell(r, c).number_format = "@"
            if f["choices"]:
                dv = DataValidation(type="list", formula1='"' + ",".join(f["choices"]) + '"',
                                    allow_blank=not f["required"].startswith("Required"))
                dv.errorTitle = "Choose a supported value"
                dv.error = "Use a value listed in Field Definitions; do not invent a new class or mode."
                dv.showErrorMessage = True
                dv.errorStyle = "stop"
                ws.add_data_validation(dv)
                dv.add(f"{get_column_letter(c)}2:{get_column_letter(c)}1001")
        ws.auto_filter.ref = f"A1:{get_column_letter(len(fields))}{max(2, len(values)+1)}"
    rowsheet(wb, "Field Definitions", FIELD_HEADERS, field_rows(),
             {4: 45, 5: 55, 6: 75, 7: 80, 8: 40})
    wb.save(path)


def inline(text):
    # All input is our own Markdown; escape first and never inject source HTML.
    text = escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    # Repository-relative links are explanatory text in the standalone deliverable.
    return re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1 (repository reference)", text)


def markdown_html(text):
    """Small renderer for the documented review format, with no external assets."""
    out = []
    lines = iter(text.splitlines())
    list_type = None
    code = False
    table = False

    def close_list():
        nonlocal list_type
        if list_type:
            out.append(f"</{list_type}>")
            list_type = None

    for line in lines:
        if line.startswith("```"):
            close_list()
            if table:
                out.append("</tbody></table></div>")
                table = False
            out.append("</code></pre>" if code else "<pre><code>")
            code = not code
            continue
        if code:
            out.append(escape(line) + "\n")
            continue
        if line.startswith("|"):
            close_list()
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if all(re.fullmatch(r"[-: ]+", c) for c in cells):
                continue
            if not table:
                out.append('<div class="table-wrap"><table><thead><tr>' +
                           "".join(f"<th>{inline(c)}</th>" for c in cells) + "</tr></thead><tbody>")
                table = True
            else:
                out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells) + "</tr>")
            continue
        if table:
            out.append("</tbody></table></div>")
            table = False
        if not line.strip():
            close_list()
            continue
        if line.startswith("#"):
            close_list()
            level = min(6, len(line) - len(line.lstrip("#")))
            out.append(f"<h{level}>{inline(line[level:].strip())}</h{level}>")
            continue
        kind = "ul" if line.startswith("- ") else ("ol" if re.match(r"\d+\. ", line) else None)
        if kind:
            if list_type != kind:
                close_list()
                out.append(f"<{kind}>")
                list_type = kind
            content = line[2:] if kind == "ul" else re.sub(r"^\d+\. ", "", line)
            out.append(f"<li>{inline(content)}</li>")
        else:
            close_list()
            out.append(f"<p>{inline(line)}</p>")
    close_list()
    if table:
        out.append("</tbody></table></div>")
    return "\n".join(out)


def document_html(text):
    return """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shareholder Management — Legacy Import Design Review</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f6f5f0;color:#25352c;font:16px/1.6 system-ui,sans-serif}
main{max-width:1250px;margin:auto;padding:48px 32px 80px}h1{font-size:36px;line-height:1.2;max-width:900px}
h2{margin-top:48px;border-bottom:2px solid #d8e2d9;padding-bottom:8px;font-size:25px}h3{margin-top:30px}
p,li{max-width:1050px}li{margin-bottom:13px}code{background:#e8eee8;padding:2px 5px;border-radius:3px;overflow-wrap:anywhere}
pre{white-space:pre-wrap;padding:20px;background:#e8eee8}.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px;background:white}th,td{text-align:left;vertical-align:top;padding:13px;border:1px solid #dce2dc;min-width:130px}
th{background:#1d3b2c;color:white}tr:nth-child(even){background:#f1f5f1}
.badge{display:inline-block;padding:6px 12px;background:#fff0c5;border:1px solid #ddc779;border-radius:4px;font-weight:700}
footer{margin-top:50px;font-size:13px;color:#58665c}@media(max-width:600px){main{padding:24px 18px}h1{font-size:29px}}
@media print{body{background:white}main{padding:0;max-width:none}h2,h3{break-after:avoid}tr{break-inside:avoid}.table-wrap{overflow:visible}table{font-size:10px}th,td{padding:6px;min-width:0}pre{font-size:11px}}
</style></head><body><main><div class="badge">DRAFT · BUSINESS REVIEW REQUIRED · NO PRODUCTION EXECUTION</div>""" + markdown_html(text) + """<footer>Shareholder Management · Design gate only. No application data was reset or imported.</footer></main></body></html>"""


def source_bindings():
    bindings = {}
    for sheet, fields in FIELDS.items():
        for f in fields:
            for ref in f["source"].split("; "):
                parts = ref.split("/", 2)
                if len(parts) == 3:
                    bindings.setdefault(tuple(parts), []).append(
                        f"{sheet}.{f['field']} → {f['destination']} | {f['rule']}")
    return bindings


def disposition(alias, sheet, column, bindings):
    mapped = bindings.get((alias, sheet, column))
    if mapped:
        return "Proposed mapping / evidence; review required", "\n".join(mapped)
    if alias in ("CLASS", "CONTRIB", "OWNERSHIP") or sheet in ("Company", "Summary", "Ownership", "Voting Ownership", "ShareClasses"):
        return "Reconciliation / legacy evidence only", "R14/R17; retain source definition and matching scope. No automatic legal-rights or Settings update."
    if column in ("Certificate ID", "Security ID"):
        return "Certificate cross-check only", "Match to resolved unique certificate ID; do not create another certificate from this report."
    if column in ("External ID", "Stakeholder External ID"):
        return "Identity suggestion / review evidence", "R01/R02; business ID is not a technical FK. Resolve via reviewed identity link."
    if column in ("Stakeholder", "Stakeholder Name", "Transferred To"):
        return "Display / review evidence only", "R02/R10; names are not relationship keys; never auto-link by name."
    if alias in ("GRANTS", "CANCEL", "VEST"):
        return "Supplement / historical evidence; not an automatic write", "R08/R10/R14/R17; reconcile dates, prices, quantities, status and vesting; unsupported events stay in archive pending approval."
    return "Archive / review; no current app write", "Preserve in the approved Azure/SharePoint legacy archive. Do not discard or add unapproved app fields. D03/D05/D10."


def review_lines(markdown, prefix):
    return [line[2:] for line in markdown.splitlines() if line.startswith(prefix)]


def make_mapping(path, assessment, markdown):
    wb = newbook()
    rowsheet(wb, "Read Me", ["Topic", "Review Guidance"], [
        ["Status", "All mappings and templates are proposed. Review approval is not production execution approval."],
        ["Sources", "Nine supplied examples; structures/counts only. No personal source rows are copied here."],
        ["Source Columns", "Every discovered header has a proposed mapping or explicit evidence/archive disposition. Summary layouts may contain additional nested headings."],
        ["Authority", "Raw technical IDs/ledger are candidates only. Resolve duplicates, missing owners, conflicting totals and historical scope before implementation."],
        ["Mapping gaps", "Fractions, cancellation/repurchase ledger, historical actors and PDF request/template requirements need approved app/provenance changes."],
        ["Review process", "Use Decisions for comments/approval evidence. Authoritative approval must be recorded separately; editing a workbook cannot authorize a reset."],
        ["Boundary", "No database or SharePoint calls, converter, UI, reset command or production import is included."],
    ], {2: 120})
    inventory, source_columns, findings = [], [], []
    bindings = source_bindings()
    for file in assessment["files"]:
        alias, role = alias_for(file["file"])
        for sheet in file["sheets"]:
            inventory.append([
                alias, file["file"], sheet["sheet"], sheet["header_row"],
                sheet["populated_rows_below_header"], sheet["visibility"],
                sheet["formula_cells"], sheet["formula_cells_without_cache"], role,
                file["sha256"], sheet["note"],
            ])
            for col in sheet["columns"]:
                state, handling = disposition(alias, sheet["sheet"], col["name"], bindings)
                source_columns.append([alias, sheet["sheet"], col["column"], col["name"], state, handling, "Proposed"])
    rowsheet(wb, "Source Inventory",
             ["Alias", "Workbook", "Sheet", "Header Row", "Populated Rows Below Header", "Visibility", "Formula Cells", "Missing Formula Caches", "Role", "File SHA256", "Count Caveat"],
             inventory, {2: 65, 3: 35, 9: 60, 10: 68, 11: 65})
    rowsheet(wb, "Source Columns",
             ["Alias", "Sheet", "Column Number", "Source Header", "Disposition", "Mapping / Rule / Gap", "Review Status"],
             source_columns, {2: 35, 4: 48, 5: 55, 6: 115})
    rowsheet(wb, "Field Mapping", FIELD_HEADERS, field_rows(), {4: 45, 5: 60, 6: 90, 7: 100, 8: 40})
    rule_rows = []
    for line in markdown.splitlines():
        if line.startswith("- **R"):
            ident = re.search(r"R\d+", line).group()
            rule_rows.append([ident, line[2:].replace("**", ""), "Proposed", ""])
    rowsheet(wb, "Conversion Rules", ["Rule", "Rule / Validation", "Status", "Reviewer Comments"],
             rule_rows, {2: 145, 4: 60})
    decisions = [
        [*([cell.strip() for cell in line.strip("|").split("|")]),
         "Confirmed: up to 2 decimal places" if line.startswith("| D01 ") else "Pending", "", ""]
        for line in markdown.splitlines() if re.match(r"^\| D\d+", line)
    ]
    rowsheet(wb, "Decisions",
             ["Decision", "Question", "Recommendation", "Effect While Unresolved", "Review Status", "Reviewer Comments", "Approval Evidence Reference"],
             decisions, {2: 55, 3: 90, 4: 65, 6: 65, 7: 55})
    section = markdown.split("## Review these first\n", 1)[1].split("\n## ", 1)[0]
    for line in section.splitlines():
        if re.match(r"\d+\. ", line):
            findings.append([re.match(r"\d+", line).group(), re.sub(r"^\d+\. ", "", line).replace("**", ""), "Review required", ""])
    rowsheet(wb, "Findings", ["Finding", "Evidence / Implication", "Status", "Reviewer Comments"], findings, {2: 150, 4: 70})
    wb.save(path)


def build(output=OUTPUT):
    output.mkdir(parents=True, exist_ok=True)
    assessment = json.loads((DOCS / "source-assessment.json").read_text())
    markdown = (DOCS / "README.md").read_text()
    make_template(output / "Legacy_Import_Templates_DRAFT.xlsx")
    make_template(output / "Legacy_Import_Synthetic_Example.xlsx", examples=True)
    make_mapping(output / "Legacy_Import_Mapping_Review.xlsx", assessment, markdown)
    (output / "Legacy_Import_Design_Review.html").write_text(document_html(markdown))
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    output = build(args.output)
    print(f"Prepared four review files in {output.relative_to(ROOT) if output.is_relative_to(ROOT) else output}")
