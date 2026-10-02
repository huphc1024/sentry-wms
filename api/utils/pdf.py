"""Portable HTML-to-PDF rendering helpers."""

from io import BytesIO
from pathlib import Path
from threading import Lock

from xhtml2pdf import pisa
from xhtml2pdf.files import LocalFileURI, pisaFileObject


_PDF_RENDER_LOCK = Lock()


def _unicode_font_path() -> Path | None:
    candidates = (
        Path(__file__).parents[1] / "static" / "fonts" / "DejaVuSans.ttf",
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    )
    return next((path.resolve() for path in candidates if path.is_file()), None)


def _unicode_font_css(font_path: Path | None) -> str:
    if not font_path:
        return ""
    return (
        "<style>"
        "@font-face { font-family: WmsPdfFont; "
        "src: url('wms-pdf-font.ttf'); }"
        "body { font-family: WmsPdfFont; }"
        "</style>"
    )


def html_to_pdf(html: str) -> bytes:
    """Render UTF-8 HTML into PDF bytes without external OS runtimes."""
    font_path = _unicode_font_path()
    font_css = _unicode_font_css(font_path)
    if font_css:
        html = html.replace("</head>", f"{font_css}</head>", 1)

    def resolve_resource(uri: str, _relative_uri: str | None = None) -> str:
        if uri == "wms-pdf-font.ttf" and font_path:
            return str(font_path)
        return uri

    output = BytesIO()

    # xhtml2pdf copies local fonts into an open NamedTemporaryFile. Windows
    # prevents ReportLab from reopening that file, so local resources can be
    # handed to ReportLab directly. The lock keeps the scoped patch thread-safe.
    original_get_named_file = pisaFileObject.getNamedFile

    def get_named_file(file_object) -> str | None:
        if isinstance(file_object.instance, LocalFileURI):
            file_object.instance.get_data()
            uri = file_object.instance.get_uri()
            if uri:
                return str(uri)
        return original_get_named_file(file_object)

    with _PDF_RENDER_LOCK:
        pisaFileObject.getNamedFile = get_named_file
        try:
            result = pisa.CreatePDF(
                src=html,
                dest=output,
                encoding="utf-8",
                link_callback=resolve_resource,
            )
        finally:
            pisaFileObject.getNamedFile = original_get_named_file
    if result.err:
        raise RuntimeError(f"PDF rendering failed with {result.err} error(s)")
    return output.getvalue()
