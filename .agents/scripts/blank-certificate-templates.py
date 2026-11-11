import os
import pymupdf as fitz

os.makedirs("generated-artifacts/certificate-templates", exist_ok=True)
for share_class, source in [
    ("Common", "attached_assets/C-106_1793299988087.pdf"),
    ("Preferred", "attached_assets/P-2_1793300455198.pdf"),
]:
    doc = fitz.open(source)
    # Issued examples can contain embedded attachments. Remove their bytes,
    # not just their visible references, before distributing blank templates.
    for attachment in list(doc.embfile_names()):
        doc.embfile_del(attachment)
    # These supplied examples use the Names dictionary only for attachments.
    # Drop the dictionary as well, rather than leaving an EmbeddedFiles key.
    doc.xref_set_key(doc.pdf_catalog(), "Names", "null")
    page = doc[0]
    date_line = next(b for b in page.get_text("blocks") if b[4].startswith(("WITNESS,", "Dated:")))
    # Actual redaction removes the prior holder, values and signatures, not just their appearance.
    areas = [(76, 49, 225, 68), (630, 49, 725, 68), (76, 187, 720, 205),
             (76, date_line[1]-1, 720, date_line[3]+1), (76, 455, 720, 540)]
    for area in areas:
        page.add_redact_annot(fitz.Rect(area), fill=(1, 1, 1))
    page.apply_redactions(images=2, graphics=1)
    fields = {
        "certificateId": (100, 50, 240, 69),
        "quantity": (610, 50, 673, 69),
        "certificateIntro": (79, 188, 716, 205),
        "witnessText": (79, date_line[1]-1, 716, date_line[3]+2),
        "signature1": (79, 456, 342, 496),
        "signature2": (446, 456, 710, 496),
        "signer1Name": (79, 504, 342, 525),
        "signer2Name": (446, 504, 710, 525),
    }
    for name, rect in fields.items():
        widget = fitz.Widget()
        widget.field_name = name
        widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
        widget.rect = fitz.Rect(rect)
        widget.field_value = ""
        widget.text_font = "TiRo"
        widget.text_fontsize = 0
        widget.field_label = name
        page.add_widget(widget)
    page.draw_line((79, 498), (342, 498), width=0.4)
    page.draw_line((446, 498), (710, 498), width=0.4)
    page.insert_text((79, 62), "ID:", fontsize=11, fontname="tiro")
    page.insert_text((680, 62), "Shares", fontsize=11, fontname="tiro")
    doc.set_metadata({})
    doc.del_xml_metadata()
    target = f"generated-artifacts/certificate-templates/{share_class.lower()}-blank.pdf"
    doc.save(target, garbage=4, deflate=True, clean=True)
    check = fitz.open(target)
    print(share_class, "fields:", [w.field_name for w in check[0].widgets()])
    check[0].get_pixmap().save(f"/tmp/certificate-inspection/{share_class.lower()}-blank.png")
