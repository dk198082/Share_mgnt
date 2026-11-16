"""Proposed review contract only. No runtime adapters or production mappings."""


def field(name, required, fmt, destination, source, rule, example="", choices=()):
    if name in {"original_quantity", "outstanding_quantity", "verified_transferred_quantity",
                "cancelled_quantity", "repurchased_quantity", "quantity", "expected_outstanding"}:
        fmt = "Exact nonnegative decimal TEXT; up to 2 decimal places; reject excess precision"
    return {
        "field": name, "required": required, "format": fmt,
        "destination": destination, "source": source, "rule": rule,
        "synthetic_example": example, "choices": choices,
        "approval": "Proposed - not approved",
    }


TEXT = "Text; preserve identifiers and leading zeros"
DATE = "YYYY-MM-DD; valid calendar date; blank if unknown and optional"
DECIMAL = "Exact nonnegative decimal TEXT; no rounding; field precision/scale to be agreed"
PROPOSED = "PROPOSED import staging/provenance; not an existing app field"
ARCHIVE = "PROPOSED protected legacy evidence/archive; destination approval required"

FIELDS = {
    "Import_Run": [
        field("run_reference", "Required", TEXT, PROPOSED, "Operator input", "Unique run reference; does not authorize execution", "SYNTHETIC-REVIEW-001"),
        field("mode", "Required", "Enum", PROPOSED, "Operator input", "Initial reset remains separately approved", "InitialMigration", ("InitialMigration", "FutureAddOnly")),
        field("history_scope", "Required", "Enum", PROPOSED, "Business review D03", "OpeningBalances needs a separately approved representation", "FullHistory", ("FullHistory", "OpeningBalances")),
        field("cutoff_date", "Required", DATE, PROPOSED, "Approved source snapshot", "All comparisons use the same cutoff and population", "2026-10-31"),
        field("source_system", "Required", TEXT, PROPOSED, "Operator input", "Namespace all legacy crosswalk keys", "SYNTHETIC"),
        field("source_snapshot_reference", "Required", TEXT, PROPOSED, "Approved source snapshot", "Link to approved file fingerprints, filters and population", "Synthetic fixture only"),
        field("mapping_revision", "Required", TEXT, PROPOSED, "Approved mapping register", "DRAFT value is never executable approval", "DRAFT-REVIEW"),
        field("review_evidence_reference", "Conditional", TEXT, PROPOSED, "Authorized review receipt", "Required at commit; workbook text is not authorization", ""),
    ],
    "Shareholders": [
        field("legacy_shareholder_id", "Required", TEXT, PROPOSED, "RAW/StakeholderCompanies/Id", "R01-R02; stable technical key, not name/email/External ID", "SYN-H-001"),
        field("name", "Required", "Text; 1-200 characters", "shareholders.data.name", "RAW/StakeholderCompanies/Name; PEOPLE/Stakeholders/Name", "R02-R03; conflicts reviewed, no automatic merges", "Synthetic Holder Alpha"),
        field("external_id", "Optional", "Text; maximum 100 characters", "shareholders.data.generationNumber", "RAW/StakeholderCompanies/ExternalId; PEOPLE/Stakeholders/External ID", "R01; business field, not the technical PK", "SYN-G-001"),
        field("email", "Optional", "Valid email; maximum 254 characters", "shareholders.data.email", "RAW/StakeholderCompanies/Email; PEOPLE/Stakeholders/Email", "R03; blank permitted, conflicts reviewed", "alpha@example.test"),
        field("date_of_birth", "Optional", DATE, "shareholders.data.dateOfBirth", "Not supplied in current layouts", "R04; no future dates; no inference", ""),
        field("date_of_passing", "Optional", DATE, "shareholders.data.dateOfPassing", "Not supplied in current layouts", "R04; not Termination Date; on/after birth if known", ""),
        field("address_line", "Optional", "Text", "shareholders.data.address (assembled)", "PEOPLE/Stakeholders/Address", "R03; retain structured staging components", "100 Example Lane"),
        field("city", "Optional", "Text", "shareholders.data.address (assembled)", "RAW/StakeholderCompanies/City; PEOPLE/Stakeholders/City", "R03; review cross-file conflicts", "Sample City"),
        field("state", "Optional", "Text", "shareholders.data.address (assembled)", "RAW/StakeholderCompanies/State; PEOPLE/Stakeholders/State", "R03; assembled full address max 1000 characters", "ZZ"),
        field("postal_code", "Optional", TEXT, "shareholders.data.address (assembled)", "RAW/StakeholderCompanies/ZipCode; PEOPLE/Stakeholders/Zip Code", "R03; preserve leading zeros and non-US formats", "00000"),
        field("country", "Optional", "Text; source country code/name", "shareholders.data.address (assembled)", "RAW/StakeholderCompanies/Country; PEOPLE/Stakeholders/Country", "R03; normalize only through approved code table", "US"),
        field("phone", "Optional", "Text; maximum 50 characters", "shareholders.data.phone", "Not supplied in current layouts", "R04; preserve international format; never invent", ""),
        field("family_line", "Optional", "Text; maximum 200 characters", "shareholders.data.familyLine", "PEOPLE/Stakeholders/Comments", "D04; approved Comments-to-Family-line mapping; preserve text, allow blanks, reject overlength; retain notes", "Synthetic Line A"),
        field("notes", "Optional", "Text; maximum 5000 characters", "shareholders.data.financialNotes (proposed)", "PEOPLE/Stakeholders/Comments", "D04; section 04 notes only after approval; no truncation", "Synthetic import example; not a real shareholder."),
        field("ssn", "Optional protected", "Protected nine-digit text via approved Azure-only path", "shareholders.ssn_encrypted + ssn_last4", "PEOPLE/Stakeholders/SSN", "R04; blank in samples; never plaintext JSON/audit/log/export", ""),
        field("entity_type", "Optional", "Source text", ARCHIVE, "RAW/StakeholderCompanies/StakeholderType; PEOPLE/Stakeholders/Type", "D05; current app has no dedicated entity-type field", ""),
        field("relationship", "Optional", "Source text", ARCHIVE, "RAW/StakeholderCompanies/Relationship; PEOPLE/Stakeholders/Relationship", "D05; not an app role or permission", ""),
        field("termination_date", "Optional", DATE, ARCHIVE, "RAW/StakeholderCompanies/TerminationDate; PEOPLE/Stakeholders/Termination Date", "R04-R05; never maps to date of passing", ""),
    ],
    "Identity_Links": [
        field("source_report", "Required if used", TEXT, PROPOSED, "File fingerprint/alias", "Reviewed report-to-technical-ID link; no fuzzy matching", ""),
        field("source_file_sha256", "Required if used", "64 lowercase hexadecimal characters", PROPOSED, "Original source file bytes", "Tie physical row reference to an immutable source fingerprint", ""),
        field("source_sheet", "Required if used", TEXT, PROPOSED, "Source sheet", "Together with row and fingerprint identifies evidence", ""),
        field("source_row_reference", "Required if used", TEXT, PROPOSED, "Physical source row", "Use original row, never renumber after filtering", ""),
        field("external_id", "Optional", TEXT, PROPOSED, "Report External ID", "Suggestion/evidence only; not guaranteed unique", ""),
        field("legacy_shareholder_id", "Required if used", TEXT, PROPOSED, "RAW/StakeholderCompanies/Id", "Must resolve to Shareholders.legacy_shareholder_id", ""),
        field("review_evidence_reference", "Required if used", TEXT, PROPOSED, "Authorized identity review", "Do not infer identity from name/email alone", ""),
    ],
    "Certificates": [
        field("legacy_security_id", "Required", TEXT, PROPOSED, "RAW/Securities/Id", "R01; preserve distinct security IDs even when certificate labels collide", "SYN-S-001"),
        field("certificate_id", "Required", "C-n or P-n; positive integer suffix; unique", "certificates.id + sequence_number", "RAW/Securities/CertificateId; CAP/C-Common/Certificate ID; CAP/PS-Preferred/Certificate ID", "R06; duplicate/nonstandard IDs block; preserve, never silently renumber", "C-9001"),
        field("owner_legacy_id", "Required", TEXT, "certificates.shareholder_id via approved crosswalk", "RAW/Securities/StakeholderId", "R02; must resolve to Shareholders; not owner name", "SYN-H-001"),
        field("share_class", "Required", "Enum", "certificates.share_class", "RAW/Securities/SecurityClassId; RAW/ShareClasses/Id; RAW/ShareClasses/Name", "R06; class lookup + prefix must agree", "Common", ("Common", "Preferred")),
        field("issue_date", "Required for proposed contract", DATE, "certificates.issue_date", "RAW/Securities/IssueDate; CAP/C-Common/Issue Date; CAP/PS-Preferred/Issue Date", "R15; missing historical dates need an approved exception, not today's date", "2020-01-01"),
        field("original_quantity", "Required", DECIMAL, "certificates.quantity (numeric with scale 2)", "RAW/Securities/IssuedAmount; CAP/C-Common/Shares Issued; CAP/PS-Preferred/Shares Issued", "R07-R08; positive; original quantity never replaced by remaining balance", "100"),
        field("outstanding_quantity", "Required", DECIMAL, "Derived app remainingQuantity; explicit staging control", "RAW/Securities/OutstandingAmount; CAP/C-Common/Shares Outstanding; CAP/PS-Preferred/Shares Outstanding", "R08; not a separate current certificate column; reconcile to movements", "40"),
        field("verified_transferred_quantity", "Conditional", DECIMAL, "certificates.transferred_quantity only after evidence", "CAP/C-Common/Shares Transferred; CAP/PS-Preferred/Shares Transferred; reviewed historical allocations", "R08; no raw TransferredAmount column; do not infer from all cancellation values", "60"),
        field("cancelled_quantity", "Conditional", DECIMAL, "GAP: no separate app cancellation-quantity ledger", "RAW/Securities/CancelledAmount; CAP/C-Common/Shares Cancelled; CAP/PS-Preferred/Shares Cancelled", "R08; TRANSFER cancellations must not be double-counted; D03/D10", "0"),
        field("repurchased_quantity", "Conditional", DECIMAL, "GAP: no separate app repurchase-quantity ledger", "RAW/Securities/RepurchasedAmount; RAW/Securities/SharesRepurchased; CAP/C-Common/Shares Repurchased; CAP/PS-Preferred/Shares Repurchased", "R08; do not assume two source columns are additive", "0"),
        field("legacy_status", "Required", "Source enum", "certificates.status via R08; unresolved cases blocked", "RAW/Securities/Status", "OUTSTANDING/TRANSFERRED/CANCELLED need balance evidence", "OUTSTANDING", ("OUTSTANDING", "TRANSFERRED", "CANCELLED")),
        field("vesting_schedule", "Conditional", "Text; maximum 500 characters for app", "certificates.vesting_schedule", "CAP/C-Common/Vesting Schedule; CAP/PS-Preferred/Vesting Schedule; VEST/Equity Subject to Vesting/Vesting Schedule", "R14; required before promotion; missing text must not imply fully vested", "Fully vested upon grant"),
        field("vesting_start_date", "Optional", DATE, ARCHIVE, "RAW/Securities/VestingStartDate; CAP/C-Common/Vesting Start Date; CAP/PS-Preferred/Vesting Start Date", "R14; current certificate model stores schedule text only", ""),
        field("historical_price_per_share", "Optional", DECIMAL, ARCHIVE, "RAW/Securities/PricePerShare; CAP/C-Common/Price Per Share; CAP/PS-Preferred/Price Per Share", "R14; not current Settings share price", ""),
        field("capital_contribution", "Optional", DECIMAL, ARCHIVE, "RAW/Securities/CapitalContribution; CAP/C-Common/Capital Contribution; CAP/PS-Preferred/Capital Contribution", "R14; historical evidence, no financial-rights inference", ""),
        field("cancellation_date", "Optional", DATE, ARCHIVE, "RAW/Securities/CancellationDate; CANCEL/Grants Outstanding Canceled/Effective Date of Cancellation in Pulley", "R08-R10; not automatically transfer date", ""),
        field("cancellation_reason", "Optional", "Source text", ARCHIVE, "RAW/Securities/CancellationReason; CANCEL/Grants Outstanding Canceled/Reason For Cancellation", "R08; classify before assigning any movement amount", ""),
        field("parent_legacy_security_id", "Optional", TEXT, PROPOSED, "RAW/Securities/TransferredFrom", "R10; zero/blank means no parent evidence; no automatic transfer", ""),
        field("legacy_acceptance_status", "Optional", "Source text", ARCHIVE, "RAW/Securities/AcceptanceStatus", "R09; never app approval state", ""),
        field("historical_issued_by", "Optional", "Source actor identifier only if known", "GAP: historical actor/provenance model needs review", "Not supplied in current layouts", "R13; unknown is not the import operator", ""),
    ],
    "Transfers": [
        field("legacy_transfer_id", "Required if history", TEXT, PROPOSED, "Reviewed transaction evidence; no transaction-ID column supplied", "R10; stable reviewed movement key, not an invented historical transaction", "SYN-T-001"),
        field("source_owner_legacy_id", "Required if history", TEXT, "share_transfers.originator_id via crosswalk", "Reviewed parent security owner", "R11; one source owner per batch", "SYN-H-001"),
        field("recipient_owner_legacy_id", "Required if history", TEXT, "share_transfers.recipient_id via crosswalk", "Reviewed recipient security owner", "R11; different source/recipient", "SYN-H-002"),
        field("recipient_certificate_id", "Required if history", "Unique certificate ID", "share_transfers.recipient_certificate_id", "Reviewed child security CertificateId", "R11; one certificate per transfer; no new issuance", "C-9003"),
        field("share_class", "Required if history", "Enum", "share_transfers.share_class", "Reviewed related securities/class lookup", "R11; must match all certificates", "Common", ("Common", "Preferred")),
        field("quantity", "Required if history", DECIMAL, "share_transfers.quantity (numeric with scale 2)", "Reviewed transaction/allocation evidence", "R07/R11; positive; equals allocation sum", "90"),
        field("transfer_date", "Required if history", DATE, "share_transfers.transfer_date", "Reviewed date evidence; CAP/C-Common/Transfer Date; CAP/PS-Preferred/Transfer Date", "R10/R15; dates must be evidenced and chronological", "2021-01-01"),
        field("reason", "Optional", "Source reason text; approved translation", "share_transfers.reason", "RAW/Securities/TransferReason; CAP/C-Common/Transfer Reason; CAP/PS-Preferred/Transfer Reason", "Map DEATH/ DIVORCE/ DONATION/ GIFT/ SECONDARY_SALE/ TRANSFER_TO_AFFILIATE/ OTHER only after review; unknown retained as evidence", "Gift"),
        field("historical_price_per_share", "Optional", DECIMAL, "share_transfers.price_per_share if transfer-specific evidence", "Reviewed historical transfer price", "Never substitute current Settings or certificate grant price", ""),
        field("historical_actor", "Optional", "Historical identifier only if evidenced", "GAP: separate historical/import provenance required", "Not supplied in current layouts", "R13; never fabricate employee attribution", ""),
        field("historical_event_time_utc", "Optional", "ISO 8601 UTC timestamp ending Z", "GAP: historical timestamp provenance", "Not supplied in current layouts", "R13/R15; date-only source stays date-only", ""),
        field("evidence_reference", "Required if history", TEXT, PROPOSED, "Reviewed source evidence", "Must support allocations, date, reason and relationship", "Synthetic batch fixture"),
    ],
    "Transfer_Allocations": [
        field("legacy_transfer_id", "Required if history", TEXT, "share_transfers.id via transfer crosswalk", "Reviewed historical movement", "R11; resolve to Transfers.legacy_transfer_id", "SYN-T-001"),
        field("source_certificate_id", "Required if history", "Certificate ID", "share_transfers.sources[].certificateId", "Reviewed parent CertificateId", "R11; unique per transfer, same owner/class", "C-9001"),
        field("quantity", "Required if history", DECIMAL, "share_transfers.sources[].quantity", "Reviewed allocation evidence", "R11; positive, available at time, total equals transfer", "60"),
    ],
    "Documents": [
        field("legacy_document_id", "Required if used", TEXT, PROPOSED, "No document manifest supplied", "R16; stable across retries", ""),
        field("entity_type", "Required if used", "Enum", "PROPOSED legacy document association", "No document manifest supplied", "Entity type determines legacy key domain", "", ("Shareholder", "Certificate", "Transfer")),
        field("entity_legacy_id", "Required if used", TEXT, "PROPOSED legacy document association", "No document manifest supplied", "Shareholder technical ID / legacy_security_id / legacy_transfer_id, not certificate label", ""),
        field("file_reference", "Required if used", "Approved SharePoint-relative file reference", "Approved SharePoint storage adapter reference", "CAP/C-Common/Documents; CAP/PS-Preferred/Documents; separate manifest", "R16; report text is not proof file exists; no signed URLs/credentials", ""),
        field("original_filename", "Required if used", "Filename only; no traversal", "Document display name", "Original file manifest", "R16; retain original filename safely", ""),
        field("document_type", "Required if used", "Enum", "PROPOSED legacy document classification", "Original file manifest", "Historical originals not current templates", "", ("OriginalCertificate", "SupportingDocument", "ProfilePicture")),
        field("content_type", "Required if used", "Approved MIME type", "Document content type", "Verified original bytes", "R16; check bytes, allowed types and approved limits", ""),
        field("size_bytes", "Required if used", "Positive integer", "Verified file size", "Verified original bytes", "R16; no default size or unverified success", ""),
        field("sha256", "Required if used", "64 lowercase hexadecimal characters", "PROPOSED file integrity receipt", "Verified original bytes", "R16; compare before marking available", ""),
        field("original_date", "Optional", DATE, ARCHIVE, "Original file metadata/evidence", "R13/R16; no invented historical upload time", ""),
    ],
    "Reconciliation": [
        field("scope", "Required if used", "Enum", PROPOSED, "Approved matching source controls", "R17; never mix company and sampled populations", "Class", ("Company", "Class", "Shareholder")),
        field("owner_legacy_id", "Conditional", TEXT, PROPOSED, "Reviewed identity crosswalk", "Required for Shareholder scope; otherwise blank", ""),
        field("share_class", "Required if used", "Enum", PROPOSED, "RAW/ShareClasses/Name", "Use All only for Company/Shareholder combined controls", "Common", ("Common", "Preferred", "All")),
        field("expected_outstanding", "Required if used", DECIMAL, PROPOSED, "Approved source controls matching cutoff/scope", "R17; outstanding is not original issued or fully diluted", "142"),
        field("expected_certificate_count", "Optional", "Nonnegative integer", PROPOSED, "Approved matching certificate inventory", "Count all included statuses for that scope; document population", "4"),
        field("control_evidence_reference", "Required if used", TEXT, PROPOSED, "Approved source controls", "Record snapshot, definitions and population", "Synthetic fixture only"),
    ],
}

ALIASES = [
    ("Cap_table_", "CLASS", "Class totals; reconcile only"),
    ("Stakeholder_mng_", "CONTRIB", "Holder contribution totals; reconcile only"),
    ("TiniusOlsenInternationalCompany_Stakeholder_report", "PEOPLE", "Profile enrichment after reviewed identity links"),
    ("TiniusOlsenInternationalCompany_Vesting_Report", "VEST", "Vesting supplement/evidence"),
    ("TiniusOlsenInternationalCompany_captable", "CAP", "Certificate supplement and reconciliation controls"),
    ("Tinius_Olsen_International_Company_raw_cap_table", "RAW", "Candidate primary technical IDs/ledger; gaps block"),
    ("grants-outstanding", "CANCEL", "Cancellation/expiry/transfer-depletion evidence"),
    ("securities-granted", "GRANTS", "Issuance cross-checks"),
    ("stakeholder-ownership", "OWNERSHIP", "Holder/class balances; reconcile only"),
]


def alias_for(filename):
    return next((alias, role) for prefix, alias, role in ALIASES if filename.startswith(prefix))


def synthetic_data():
    """Hand-authored fiction. No uploaded workbook is opened or used here."""
    result = {sheet: [] for sheet in FIELDS}
    result["Import_Run"] = [{
        "run_reference": "SYNTHETIC-REVIEW-001", "mode": "InitialMigration",
        "history_scope": "FullHistory", "cutoff_date": "2026-10-31",
        "source_system": "SYNTHETIC", "source_snapshot_reference": "Synthetic fixture only",
        "mapping_revision": "DRAFT-REVIEW",
    }]
    for suffix, name in [("001", "Alpha"), ("002", "Beta"), ("003", "Gamma")]:
        result["Shareholders"].append({
            "legacy_shareholder_id": "SYN-H-" + suffix,
            "name": "Synthetic Holder " + name,
            "external_id": "SYN-G-" + suffix,
            "email": name.lower() + "@example.test",
            "family_line": "Synthetic Line " + ("A" if suffix == "001" else "B"),
            "notes": "Wholly synthetic fixture; not a real shareholder.",
        })
    rows = [
        ("001", "C-9001", "001", "Common", "100", "40", "60", "OUTSTANDING", "2020-01-01"),
        ("002", "C-9002", "001", "Common", "30", "0", "30", "TRANSFERRED", "2020-01-01"),
        ("003", "C-9003", "002", "Common", "90", "90", "0", "OUTSTANDING", "2021-01-01"),
        ("004", "C-9004", "003", "Common", "12", "12", "0", "OUTSTANDING", "2022-01-01"),
        ("005", "P-9001", "001", "Preferred", "20", "0", "20", "TRANSFERRED", "2020-01-01"),
        ("006", "P-9002", "002", "Preferred", "20", "20", "0", "OUTSTANDING", "2021-01-01"),
        ("007", "P-9003", "003", "Preferred", "5", "5", "0", "OUTSTANDING", "2022-01-01"),
    ]
    for sid, cid, owner, cls, original, outstanding, transferred, status, issued in rows:
        result["Certificates"].append({
            "legacy_security_id": "SYN-S-" + sid, "certificate_id": cid,
            "owner_legacy_id": "SYN-H-" + owner, "share_class": cls,
            "original_quantity": original, "outstanding_quantity": outstanding,
            "verified_transferred_quantity": transferred, "cancelled_quantity": "0",
            "repurchased_quantity": "0", "legacy_status": status, "issue_date": issued,
            "vesting_schedule": "Fully vested upon grant",
        })
    for suffix, cert, cls, qty in [("001", "C-9003", "Common", "90"), ("002", "P-9002", "Preferred", "20")]:
        result["Transfers"].append({
            "legacy_transfer_id": "SYN-T-" + suffix,
            "source_owner_legacy_id": "SYN-H-001", "recipient_owner_legacy_id": "SYN-H-002",
            "recipient_certificate_id": cert, "share_class": cls, "quantity": qty,
            "transfer_date": "2021-01-01", "reason": "Gift",
            "evidence_reference": "Synthetic reviewed movement " + suffix,
        })
    result["Transfer_Allocations"] = [
        {"legacy_transfer_id": "SYN-T-001", "source_certificate_id": "C-9001", "quantity": "60"},
        {"legacy_transfer_id": "SYN-T-001", "source_certificate_id": "C-9002", "quantity": "30"},
        {"legacy_transfer_id": "SYN-T-002", "source_certificate_id": "P-9001", "quantity": "20"},
    ]
    result["Reconciliation"] = [
        {"scope": "Class", "share_class": cls, "expected_outstanding": qty,
         "expected_certificate_count": count, "control_evidence_reference": "Synthetic fixture only"}
        for cls, qty, count in [("Common", "142", "4"), ("Preferred", "25", "3")]
    ]
    return result
