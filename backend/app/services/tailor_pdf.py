"""Turns a saved tailor sheet into a printable A4 PDF (with the free ReportLab library).

The PDF shows exactly what the sheet says: no new numbers are added here.
Reference pictures are included when they are PNG, JPEG or WebP files; SVG
mock sketches cannot be drawn by ReportLab, so a short note is shown instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable,
    HRFlowable,
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.schemas.outputs import TailorSheetOutput

WINE = colors.HexColor("#7a1f35")
INK = colors.HexColor("#24201d")
MUTED = colors.HexColor("#6c645c")
LINE = colors.HexColor("#e5ddd1")
PAPER = colors.HexColor("#f8f5ef")
WARN = colors.HexColor("#8a5d0c")
WARN_BG = colors.HexColor("#f8efd9")
OK = colors.HexColor("#2f6b4f")
ERR = colors.HexColor("#a3262e")

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm
FRAME_PAD = 6  # ReportLab's page frame keeps 6 points of padding on each side
CONTENT_W = PAGE_W - 2 * MARGIN - 2 * FRAME_PAD

# Fonts with wide character support (₹, arrows, accented names). If none is
# found we fall back to Helvetica and replace characters it cannot draw.
FONT_CANDIDATES = [
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
]
HELVETICA_REPLACEMENTS = {"→": "->", "₹": "Rs.", "⚠": "!", "✓": "v", "≈": "~"}

RASTER_TYPES = {"image/png", "image/jpeg", "image/webp"}


@dataclass(frozen=True)
class ReferenceImage:
    view: str
    note: str
    mime_type: str
    data: bytes | None


_font_cache: tuple[str, str, bool] | None = None


def _fonts() -> tuple[str, str, bool]:
    """(regular font, bold font, True if it is a full Unicode font)."""
    global _font_cache
    if _font_cache is None:
        _font_cache = ("Helvetica", "Helvetica-Bold", False)
        for regular, bold in FONT_CANDIDATES:
            if Path(regular).exists() and Path(bold).exists():
                try:
                    pdfmetrics.registerFont(TTFont("SheetSans", regular))
                    pdfmetrics.registerFont(TTFont("SheetSans-Bold", bold))
                except Exception:  # noqa: BLE001 - a broken font file just means we try the next one
                    continue
                _font_cache = ("SheetSans", "SheetSans-Bold", True)
                break
    return _font_cache


def _clean(text: str) -> str:
    regular, _, unicode_font = _fonts()
    if not unicode_font:
        for old, new in HELVETICA_REPLACEMENTS.items():
            text = text.replace(old, new)
        text = text.encode("cp1252", "replace").decode("cp1252")
    return escape(text)


class _CheckBox(Flowable):
    """An empty square the tailor can tick on paper."""

    def __init__(self, size: float = 3.4 * mm) -> None:
        super().__init__()
        self.size = size
        self.width = self.height = size

    def draw(self) -> None:
        self.canv.setStrokeColor(INK)
        self.canv.setLineWidth(0.6)
        self.canv.rect(0, 0, self.size, self.size)


class _Styles:
    def __init__(self) -> None:
        regular, bold, _ = _fonts()
        self.bold_font = bold
        self.title = ParagraphStyle("title", fontName=bold, fontSize=20, leading=24, textColor=WINE)
        self.subtitle = ParagraphStyle("subtitle", fontName=regular, fontSize=10, leading=13, textColor=MUTED)
        self.heading = ParagraphStyle("heading", fontName=bold, fontSize=9, leading=12, textColor=WINE,
                                      spaceBefore=10, spaceAfter=2)
        self.body = ParagraphStyle("body", fontName=regular, fontSize=9, leading=12, textColor=INK)
        self.small = ParagraphStyle("small", fontName=regular, fontSize=7.5, leading=10, textColor=MUTED)
        self.label = ParagraphStyle("label", parent=self.body, textColor=MUTED)
        self.th = ParagraphStyle("th", fontName=bold, fontSize=8, leading=10, textColor=colors.white)
        self.bullet = ParagraphStyle("bullet", parent=self.body, leftIndent=10, bulletIndent=0, spaceAfter=1.5)

    def p(self, text: str, style: ParagraphStyle | None = None) -> Paragraph:
        return Paragraph(_clean(text), style or self.body)


def _heading(s: _Styles, text: str) -> list[Flowable]:
    return [s.p(text.upper(), s.heading), HRFlowable(width="100%", thickness=0.6, color=WINE, spaceAfter=3)]


def _section(s: _Styles, text: str, content: list[Flowable]) -> list[Flowable]:
    """A heading that always stays on the same page as the start of its content."""
    return [KeepTogether([*_heading(s, text), *content[:1]]), *content[1:]]


def _kv_table(s: _Styles, rows: list[tuple[str, str]], width: float) -> Table:
    table = Table([[s.p(k, s.label), s.p(v)] for k, v in rows], colWidths=[width * 0.36, width * 0.64])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def _bullets(s: _Styles, items: list[str], numbered: bool = False) -> list[Flowable]:
    return [
        Paragraph(_clean(text), s.bullet, bulletText=f"{i}." if numbered else "•")
        for i, text in enumerate(items, start=1)
    ]


def _reference_cells(s: _Styles, images: list[ReferenceImage]) -> Table | None:
    if not images:
        return None
    cell_w = min(58 * mm, CONTENT_W / len(images))
    cells: list[list[Flowable]] = []
    for ref in images[:4]:
        caption = s.p(f"{ref.view.capitalize()} view" + (f" – {ref.note}" if ref.note else ""), s.small)
        picture: Flowable
        if ref.data and ref.mime_type in RASTER_TYPES:
            try:
                width, height = ImageReader(BytesIO(ref.data)).getSize()
                scale = min((cell_w - 4 * mm) / width, 75 * mm / height)
                picture = Image(BytesIO(ref.data), width=width * scale, height=height * scale)
            except Exception:  # noqa: BLE001 - a damaged picture should not stop the PDF
                picture = s.p("(picture could not be read)", s.small)
        else:
            picture = s.p("(vector mock sketch: open it in the app)", s.small)
        cells.append([picture, Spacer(1, 1.5 * mm), caption])
    table = Table([cells], colWidths=[cell_w] * len(cells), hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "BOTTOM"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    return table


def _measurement_table(s: _Styles, sheet: TailorSheetOutput) -> Table:
    widths = [CONTENT_W * f for f in (0.30, 0.15, 0.30, 0.25)]
    rows: list[list[Flowable]] = [[s.p(h, s.th) for h in ("Measurement", "Value", "Status", "Note")]]
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), WINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for i, m in enumerate(sheet.measurements, start=1):
        status = m.get("status", "")
        lowered = status.lower()
        colour = ERR if lowered.startswith("missing") else WARN if lowered.startswith("estimate") else OK
        status_style = ParagraphStyle(f"status{i}", parent=s.body, textColor=colour, fontName=s.bold_font)
        rows.append([s.p(m.get("name", "")), s.p(m.get("value", "")), s.p(status, status_style),
                     s.p(m.get("note", ""), s.small)])
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), PAPER))
    if len(rows) == 1:
        rows.append([s.p("No measurements entered yet."), s.p(""), s.p(""), s.p("")])
    table = Table(rows, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle(style))
    return table


def _materials_table(s: _Styles, rows: list[tuple[str, str]]) -> Table:
    table = Table(
        [[_CheckBox(), s.p(item), s.p(reason, s.small)] for item, reason in rows],
        colWidths=[7 * mm, CONTENT_W * 0.38, CONTENT_W - 7 * mm - CONTENT_W * 0.38],
    )
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (0, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]))
    return table


def _sign_off(s: _Styles) -> Table:
    labels = ["Tailor", "Trial fitting date", "Delivery date", "Client approval"]
    table = Table([[s.p(label, s.label), ""] for label in labels], colWidths=[45 * mm, CONTENT_W - 45 * mm],
                  rowHeights=[9 * mm] * len(labels))
    table.setStyle(TableStyle([
        ("LINEBELOW", (1, 0), (1, -1), 0.6, INK),
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def build_tailor_pdf(
    sheet: TailorSheetOutput,
    *,
    version_number: int,
    created_on: str,
    images: list[ReferenceImage],
) -> bytes:
    s = _Styles()
    regular, bold, _ = _fonts()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=22 * mm, bottomMargin=18 * mm,
        title=f"{sheet.title} – tailor specification", author="Drapeit by Vistas Atelier",
        subject=f"Design version {version_number}",
    )

    def decorate(canvas, document) -> None:  # noqa: ANN001 - ReportLab callback signature
        canvas.saveState()
        canvas.setFont(bold, 8)
        canvas.setFillColor(WINE)
        left, right = MARGIN + FRAME_PAD, PAGE_W - MARGIN - FRAME_PAD
        canvas.drawString(left, PAGE_H - 12 * mm, "DRAPEIT BY VISTAS ATELIER")
        canvas.setFont(regular, 8)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(right, PAGE_H - 12 * mm, "Tailor specification sheet")
        canvas.setStrokeColor(LINE)
        canvas.line(left, PAGE_H - 14 * mm, right, PAGE_H - 14 * mm)
        canvas.line(left, 13 * mm, right, 13 * mm)
        canvas.setFont(regular, 7)
        canvas.drawString(left, 9 * mm, f"Design v{version_number} · {created_on}")
        canvas.drawCentredString(PAGE_W / 2, 9 * mm, "Conceptual guidance, not a verified production pattern")
        canvas.drawRightString(right, 9 * mm, f"Page {document.page}")
        canvas.restoreState()

    design = next((sec for sec in sheet.sections if sec.heading == "Design"), None)
    subtitle_bits = [v for k, v in (design.rows if design else []) if k in ("Garment", "Occasion") and v != "Not specified"]
    counts = {"Measured": 0, "Estimate": 0, "Missing": 0}
    for m in sheet.measurements:
        for key in counts:
            if m.get("status", "").lower().startswith(key.lower()):
                counts[key] += 1

    story: list[Flowable] = [s.p(sheet.title, s.title)]
    if subtitle_bits:
        story.append(s.p(" · ".join(subtitle_bits), s.subtitle))
    story.append(Spacer(1, 4 * mm))

    meta = Table(
        [[s.p("Design version", s.small), s.p("Date", s.small), s.p("Unit", s.small), s.p("Measurements", s.small)],
         [s.p(f"v{version_number}"), s.p(created_on), s.p(sheet.unit),
          s.p(f"{counts['Measured']} measured · {counts['Estimate']} estimate · {counts['Missing']} missing")]],
        colWidths=[CONTENT_W * f for f in (0.18, 0.22, 0.12, 0.48)],
    )
    meta.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PAPER),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(meta)

    if sheet.warnings:
        box = Table([[[Paragraph(_clean(w), s.bullet, bulletText="!") for w in sheet.warnings]]],
                    colWidths=[CONTENT_W])
        box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), WARN_BG),
            ("BOX", (0, 0), (-1, -1), 0.6, WARN),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story += [Spacer(1, 4 * mm), box]

    references = _reference_cells(s, images)
    if references is not None:
        story.append(KeepTogether([*_heading(s, "Reference views"), references]))

    by_heading = {sec.heading: sec for sec in sheet.sections}
    half = (CONTENT_W - 6 * mm) / 2
    left = by_heading.get("Design")
    right = by_heading.get("Fabric & lining") or by_heading.get("Fabric")
    if left or right:
        cols = [
            [*_heading(s, sec.heading), _kv_table(s, sec.rows, half)] if sec else []
            for sec in (left, right)
        ]
        pair = Table([cols], colWidths=[half + 6 * mm, half])
        pair.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, 0), 6 * mm),
        ]))
        story.append(pair)

    for heading in ("Client & budget", "Design notes"):
        if sec := by_heading.get(heading):
            story += _section(s, heading, [_kv_table(s, sec.rows, CONTENT_W)])

    story.append(KeepTogether([
        *_heading(s, f"Measurements ({sheet.unit})"),
        _measurement_table(s, sheet),
        s.p("Only rows marked Measured were taken from the wearer. Estimates must be checked, and missing "
            "measurements taken, before any cutting.", s.small),
    ]))

    for heading, items, numbered in (
        ("Construction guidance", sheet.construction_notes, True),
        ("Cutting notes", sheet.cutting_notes, False),
        ("Stitching notes", sheet.stitching_notes, False),
    ):
        if items:
            story += _section(s, heading, _bullets(s, items, numbered))

    if materials := by_heading.get("Materials & tools"):
        story += _section(s, "Materials & tools checklist", [_materials_table(s, materials.rows)])

    if sheet.open_questions:
        story += _section(s, "Open questions", _bullets(s, sheet.open_questions))

    story.append(KeepTogether([*_heading(s, "Sign-off"), _sign_off(s)]))
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return buffer.getvalue()
