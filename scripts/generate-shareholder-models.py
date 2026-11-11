"""Regenerate the standalone model SVGs and refresh their embedded document views."""
from pathlib import Path
import html
import re

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/models"
OUT.mkdir(parents=True, exist_ok=True)
GREEN, INK, MUTED, LINE = "#173d2d", "#17221d", "#52645a", "#aebfb4"


def text(x, y, value, size=22, color=INK, weight=400, anchor="start", mono=False):
    family = "DejaVu Sans Mono,monospace" if mono else "DejaVu Sans,Arial,sans-serif"
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" fill="{color}" font-family="{family}" font-size="{size}" font-weight="{weight}">{html.escape(value)}</text>'


def label(x, y, value, size=22):
    width = len(value) * size * .59 + 28
    return (
        f'<rect x="{x-width/2}" y="{y-25}" width="{width}" height="40" rx="10" fill="#fffefa" stroke="#cbd6ce"/>'
        + text(x, y+3, value, size, GREEN, 700, "middle")
    )


def base(width, height, title, description):
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(title)}">',
        f"<title>{html.escape(title)}</title><desc>{html.escape(description)}</desc>",
        '<defs><marker id="model-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9 Z" fill="#4f745d"/></marker></defs>',
        f'<rect width="{width}" height="{height}" fill="#fffefa"/>',
        text(50, 49, "SHAREHOLDER MANAGEMENT  /  PHASE 1", 18, GREEN, 700),
        text(50, 95, title, 34, GREEN, 700),
    ]


def edge(path, dashed=False):
    dash = ' stroke-dasharray="9 7"' if dashed else ""
    return f'<path d="{path}" fill="none" stroke="#4f745d" stroke-width="3"{dash} marker-end="url(#model-arrow)"/>'


def concept():
    parts = base(1600, 960, "Conceptual Data Model", "Business entities and interactions. Labels use large dark text on white backgrounds.")
    edges = [
        ("M400 235 H620", (510, 218, "holds")),
        ("M980 235 H1180", (1080, 218, "moves shares")),
        ("M800 490 V320", (800, 405, "issues certificate")),
        ("M400 467 H510 V535 H620", (492, 450, "sets signers")),
        ("M400 705 H485 V600 H620", (470, 585, "submits / approves")),
        ("M980 535 H1060 V365 H1365 V320", (1190, 366, "completes on approval")),
        ("M980 610 H1180", (1080, 650, "retains PDF")),
        ("M1365 320 V490", (1365, 445, "links documents")),
        ("M225 790 V850 H1180", (795, 850, "records who changed what and when")),
    ]
    for path, _ in edges:
        parts.append(edge(path))
    nodes = [
        (50, 150, 350, 170, "Shareholder", ["Personal & contact details", "Family line / generation", "Protected SSN"], True),
        (620, 150, 360, 170, "Share Certificate", ["Common or Preferred", "Class-specific unique number", "Issued and remaining shares"], False),
        (1180, 150, 370, 170, "Completed Transfer", ["Originator → recipient", "One or multiple source certificates", "One new recipient certificate"], False),
        (50, 390, 350, 155, "Application Settings", ["Named signers and signatures", "Share prices and PDF templates"], False),
        (620, 490, 360, 180, "Issuance / Transfer Request", ["Requested transaction details", "Required signer snapshots", "Votes, actor IDs and timestamps"], True),
        (1180, 490, 370, 180, "Documents", ["Certificate PDFs", "Photos, signatures, attachments", "Object references and metadata"], False),
        (50, 620, 350, 170, "Employee Identity", ["Microsoft Entra sign-in", "Distinct from a Shareholder", "Verified email matches signer"], False),
        (1180, 780, 370, 125, "Activity & Audit History", ["Shareholder and Settings changes", "Individual actor and event time"], False),
    ]
    for x, y, w, h, title, lines, dark in nodes:
        parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{GREEN if dark else "#eaf1ec"}" stroke="{GREEN if dark else LINE}" stroke-width="2"/>')
        parts.append(text(x+22, y+36, title, 20 if len(title) > 23 else 23, "#ffffff" if dark else GREEN, 700))
        for i, line in enumerate(lines):
            parts.append(text(x+22, y+70+i*29, line, 18, "#edf4ef" if dark else INK))
    # Render badges last so connectors never run through label text.
    for _, (x, y, value) in edges:
        parts.append(label(x, y, value))
    parts.append(text(50, 935, "Business view • Family line is a profile attribute • Files are external to PostgreSQL • Phase 2 self-service is out of scope", 17, MUTED))
    parts.append("</svg>")
    return "\n".join(parts)


def schema_tables():
    tables = {}
    for path in sorted((ROOT / "lib/db/src/schema").glob("*.ts")):
        content = path.read_text()
        for match in re.finditer(r'export const (\w+) = pgTable\("([^"]+)", \{(.*?)\n\}', content, re.S):
            var, name, body = match.groups()
            cols = []
            for row in body.splitlines():
                m = re.match(r'\s*(\w+):\s*(\w+)\("([^"]+)"(.*)', row)
                if not m:
                    continue
                prop, typ, col, tail = m.groups()
                fk = re.search(r'references\(\(\) => (\w+)\.(\w+)', tail)
                flags = "/".join(
                    flag for flag, present in [
                        ("PK", ".primaryKey()" in tail),
                        ("FK", bool(fk)),
                        ("UQ", ".unique()" in tail),
                    ] if present
                )
                cols.append(dict(prop=prop, name=col, type=typ, flags=flags, fk=fk.groups() if fk else None))
            tables[name] = dict(var=var, cols=cols)
    assert len(tables) == 18, f"Expected 18 application tables, found {len(tables)}"
    return tables


def logical(tables):
    parts = base(3000, 2920, "Logical Data Model Detailed", "All 18 application tables. PK, FK and UQ badges identify key columns. Reference lines and the FK index identify enforced relationships.")
    parts.append(text(50, 130, "PK primary key   •   FK enforced foreign key   •   UQ column-level uniqueness   •   JSONB attributes remain embedded, not separate tables", 20, MUTED))
    positions = {
        "shareholders": (50, 225), "certificates": (640, 225),
        "share_transfers": (1230, 225), "transfer_requests": (1820, 225),
        "certificate_documents": (2410, 225),
        "certificate_counters": (50, 1300), "company_settings": (50, 1530),
        "certificate_templates": (640, 1300), "certificate_request_templates": (1230, 1300),
        "signoffs": (1820, 1300), "share_price_history": (2410, 1300),
        "users": (50, 2070), "settings_audit": (50, 2430),
        "sessions": (640, 2070), "shareholder_uploads": (640, 2290),
        "shareholder_activity": (1230, 2070),
        "signoff_email_notifications": (1820, 2070),
        "signoff_result_email_notifications": (2410, 2070),
    }
    parts.append(text(50, 185, "A  OWNERSHIP, TRANSACTIONS & CERTIFICATE EVIDENCE", 21, GREEN, 700))
    parts.append(text(50, 1260, "B  NUMBERING, SIGNERS, TEMPLATES & PRICING", 21, GREEN, 700))
    parts.append(text(50, 2025, "C  IDENTITY, HISTORY, UPLOADS & EMAIL DELIVERY", 21, GREEN, 700))
    # Selected core arrows occupy the open horizontal band above the first row.
    for x1, x2, caption in [(530, 640, "1 → N"), (1120, 1230, "source / new"), (1710, 1820, "completion"), (2300, 2410, "request PDF")]:
        parts.append(edge(f"M{x1} 270 H{x2}"))
        parts.append(text((x1+x2)/2, 213, caption, 14, GREEN, 700, "middle"))
    vars_to_names = {v["var"]: k for k, v in tables.items()}
    fks = []
    for name, (x, y) in positions.items():
        cols = tables[name]["cols"]
        height = 64 + len(cols)*29
        parts.append(f'<rect x="{x}" y="{y}" width="480" height="{height}" rx="9" fill="#ffffff" stroke="#aebfb4" stroke-width="2"/>')
        parts.append(f'<path d="M{x+9} {y} H{x+471} Q{x+480} {y} {x+480} {y+9} V{y+49} H{x} V{y+9} Q{x} {y} {x+9} {y}" fill="{GREEN}"/>')
        parts.append(text(x+16, y+32, name, 19, "#ffffff", 700, mono=True))
        for i, col in enumerate(cols):
            cy = y+75+i*29
            if col["flags"]:
                parts.append(text(x+12, cy, col["flags"], 12, "#a14f2c", 700))
            parts.append(text(x+65, cy, col["name"], 17, INK, 400, mono=True))
            parts.append(text(x+467, cy, col["type"], 14, MUTED, 400, "end"))
            if col["fk"]:
                target, prop = col["fk"]
                parent = vars_to_names[target]
                target_col = next(c["name"] for c in tables[parent]["cols"] if c["prop"] == prop)
                fks.append(f'{name}.{col["name"]} → {parent}.{target_col}')
    # A compact relationship index fills the open space below the smaller cards.
    parts.append(text(640, 1690, "ENFORCED FOREIGN-KEY INDEX", 20, GREEN, 700))
    for i, relation in enumerate(fks):
        col = i // 10
        row = i % 10
        parts.append(text(640+col*1150, 1726+row*25, relation, 15, MUTED, mono=True))
    parts.append(text(640, 2690, "MODEL NOTES", 21, GREEN, 700))
    notes = [
        "• Shareholder profile fields are stored in shareholders.data JSONB; encrypted SSN fields are separate.",
        "• Batch certificate sources and approval votes are JSONB arrays, not normalized junction tables.",
        "• Actor / owner / holder references without FK badges are application-level references.",
        "• Table-level composite/filtered unique indexes and CHECK constraints are described in the main document.",
        "• Legacy CEO/CFO columns do not define current signer policy. Preview archive is outside this active model.",
    ]
    for i, note in enumerate(notes):
        parts.append(text(640, 2725+i*29, note, 19, MUTED))
    parts.append("</svg>")
    return "\n".join(parts)


def logical_summary(tables):
    parts = base(2800, 1900, "Logical Data Model Summary", "All 18 application tables, primary keys, enforced foreign keys, and relationships. Non-key columns are omitted.")
    parts.append(text(50, 135, "PK primary key  •  FK enforced foreign key  •  arrows run from parent to dependent  •  R labels map to the relationship index", 22, MUTED))
    positions = {
        "shareholders": (50, 270), "certificates": (600, 270),
        "share_transfers": (1150, 270), "transfer_requests": (1700, 270),
        "certificate_documents": (2250, 270),
        "certificate_templates": (50, 850), "certificate_request_templates": (1150, 850),
        "signoff_email_notifications": (1700, 850),
        "signoff_result_email_notifications": (2250, 850),
    }
    # Orthogonal routing keeps connectors outside the key-only table cards.
    routes = [
        ("R1", "shareholders", "certificates", "M510 330 H600", 555, 310),
        ("R2", "shareholders", "share_transfers", "M280 270 V215 H1380 V270", 1060, 210),
        ("R3", "shareholders", "transfer_requests", "M260 270 V175 H1930 V270", 1620, 175),
        ("R4", "certificates", "share_transfers", "M1060 355 H1150", 1105, 335),
        ("R5", "certificates", "transfer_requests", "M830 405 V630 H1930 V545", 1450, 630),
        ("R6", "certificates", "certificate_documents", "M800 405 V700 H2480 V475", 2110, 700),
        ("R7", "share_transfers", "transfer_requests", "M1610 395 H1700", 1655, 375),
        ("R8", "transfer_requests", "certificate_documents", "M2160 415 H2250", 2205, 395),
        ("R9", "certificate_templates", "certificate_documents", "M510 925 H560 V770 H2760 V365 H2710", 2610, 770),
        ("R10", "certificate_templates", "certificate_request_templates", "M510 945 H1150", 830, 925),
        ("R11", "transfer_requests", "certificate_request_templates", "M1870 545 V740 H1380 V850", 1530, 740),
        ("R12", "transfer_requests", "signoff_email_notifications", "M2010 545 V850", 2010, 805),
        ("R13", "transfer_requests", "signoff_result_email_notifications", "M2160 510 H2200 V810 H2480 V850", 2350, 810),
    ]
    for _, _, _, path, _, _ in routes:
        parts.append(edge(path))

    def card(name, x, y):
        cols = [c for c in tables[name]["cols"] if "PK" in c["flags"] or c["fk"]]
        height = 65 + len(cols)*35
        parts.append(f'<rect x="{x}" y="{y}" width="460" height="{height}" rx="9" fill="#fff" stroke="{LINE}" stroke-width="2"/>')
        parts.append(f'<rect x="{x}" y="{y}" width="460" height="49" rx="9" fill="{GREEN}"/>')
        parts.append(text(x+15, y+32, name, 18, "#fff", 700, mono=True))
        for i, col in enumerate(cols):
            flags = "/".join(f for f in col["flags"].split("/") if f in ("PK", "FK"))
            parts.append(text(x+15, y+77+i*35, flags, 14, "#a14f2c", 700))
            parts.append(text(x+82, y+77+i*35, col["name"], 20, INK, mono=True))

    for name, (x, y) in positions.items():
        card(name, x, y)
    for code, _, _, _, x, y in routes:
        parts.append(label(x, y, code, 18))

    parts.append(text(50, 1090, "RELATIONSHIP INDEX — FK COLUMNS IN THE DEPENDENT TABLE", 22, GREEN, 700))
    vars_to_names = {v["var"]: name for name, v in tables.items()}
    for i, (code, parent, child, _, _, _) in enumerate(routes):
        keys = [
            c["name"] for c in tables[child]["cols"]
            if c["fk"] and vars_to_names[c["fk"][0]] == parent
        ]
        x, y = 50+(i//7)*1400, 1135+(i%7)*37
        parts.append(text(x, y, code, 19, "#a14f2c", 700))
        parts.append(text(x+60, y, f"{parent} → {child}", 17, GREEN, 700, mono=True))
        parts.append(text(x+60, y+17, "FK: " + ", ".join(keys), 13, MUTED, mono=True))

    parts.append(text(50, 1440, "TABLES WITH NO ENFORCED FOREIGN KEY IN THE CURRENT SCHEMA", 22, GREEN, 700))
    independent = [name for name in tables if name not in positions]
    for i, name in enumerate(independent):
        card(name, 50+(i%5)*550, 1485+(i//5)*170)
    parts.append(text(50, 1855, "Application-managed references and JSONB associations are intentionally not drawn as enforced database relationships.", 21, MUTED))
    parts.append("</svg>")
    return "\n".join(parts)


conceptual = concept().replace("model-arrow", "concept-model-arrow")
logical_svg = logical(schema_tables()).replace("model-arrow", "logical-model-arrow")
summary_svg = logical_summary(schema_tables()).replace("model-arrow", "summary-model-arrow")
for filename, data in [
    ("conceptual-data-model.svg", conceptual),
    ("logical-data-model-detailed.svg", logical_svg),
    ("logical-data-model-summary.svg", summary_svg),
]:
    (OUT / filename).write_text(data)

document_path = ROOT / "docs/shareholder-application-models.html"
document = document_path.read_text()
start = document.index('<section id="conceptual">')
svg_start = document.index("<svg", start)
svg_end = document.index("</svg>", svg_start) + len("</svg>")
document = document[:svg_start] + conceptual + document[svg_end:]
logical_block = (
    '<!-- logical-visual:start -->\n'
    '<h3>Logical Data Model Summary</h3>'
    '<div class="diagram" aria-label="Logical Data Model Summary">'
    + summary_svg.replace('<svg ', '<svg style="min-width:0" ', 1)
    + '</div><p class="caption">This page-sized overview replaces the detailed diagram in this document. It shows all 18 tables, primary-key and foreign-key columns, and enforced relationships only; use the independent summary SVG for lossless zoom. The full-column diagram is retained separately as Logical Data Model Detailed. The descriptive data dictionary below is retained for reference.</p>\n'
    + '<p class="small"><strong>Additional uniqueness rules:</strong> certificate class + sequence number; one active template per share class; one completed PDF per certificate and per request; approval-request email per request + signer; outcome email per request. CHECK constraints limit classes, statuses, quantities, and request payload kinds. These rules supplement the key-only summary; column-level uniqueness markers remain in the separate detailed model.</p>\n'
    '<!-- logical-visual:end -->'
)
if "<!-- logical-visual:start -->" in document:
    document = re.sub(r"<!-- logical-visual:start -->.*?<!-- logical-visual:end -->", lambda _: logical_block, document, flags=re.S)
else:
    anchor = '<div class="callout"><strong>Important distinction:</strong>'
    document = document.replace(anchor, logical_block + "\n      " + anchor, 1)
document = document.replace(
    "Solid connections represent core business relationships. Dashed connections represent supporting settings, identity, or history. The left and right Shareholder boxes illustrate the roles a person can play in a movement; they are not separate entity types.",
    "Relationship labels use larger, high-contrast text and opaque badges so they remain legible over connectors. The model distinguishes Shareholder records from employee identities and pending requests from completed ledger movements.",
)
document_path.write_text(document)
print("Updated combined document with the summary; generated conceptual, detailed logical and summary logical SVGs.")
