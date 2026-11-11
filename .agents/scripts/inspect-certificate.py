import os
import fitz

doc = fitz.open("attached_assets/C-106_1793299988087.pdf")
os.makedirs("/tmp/certificate-inspection", exist_ok=True)
print("Pages:", len(doc))
for i, page in enumerate(doc):
    print("Page", i + 1, "size", page.rect)
    print(page.get_text()[:12000])
    print("Form fields:", [
        {"name": w.field_name, "type": w.field_type_string, "value": w.field_value, "rect": list(w.rect)}
        for w in (page.widgets() or [])
    ])
    page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(f"/tmp/certificate-inspection/page-{i+1}.png")
