"""Parse Markdown with block and inline Tree-sitter grammars."""

from importlib.resources import files as _files
from importlib.metadata import PackageNotFoundError as _PackageNotFoundError
from importlib.metadata import version as _version

try:
    _runtime_version = _version("tree-sitter")
except _PackageNotFoundError:
    _runtime_version = None

# Upstream #251: 0.26.0 can parse a larger document and then crash natively
# while its nodes are traversed. Check metadata without importing the optional
# runtime, so the language-capsule API remains usable without that dependency.
if _runtime_version == "0.26.0":
    raise ImportError(
        "tree-sitter 0.26.0 can crash while traversing Markdown trees. "
        "Install tree-sitter-markdown[core] or tree-sitter>=0.25.2,<0.27,!=0.26.0."
    )

from ._binding import inline_language, language


def _get_query(name, file):
    try:
        query = _files(f"{__package__}") / file
        globals()[name] = query.read_text()
    except FileNotFoundError:
        globals()[name] = None
    return globals()[name]


def __getattr__(name):
    if name == "HIGHLIGHTS_QUERY":
        return _get_query("HIGHLIGHTS_QUERY", "queries/markdown/highlights.scm")
    if name == "INJECTIONS_QUERY":
        return _get_query("INJECTIONS_QUERY", "queries/markdown/injections.scm")
    if name == "LOCALS_QUERY":
        return _get_query("LOCALS_QUERY", "queries/locals.scm")
    if name == "TAGS_QUERY":
        return _get_query("TAGS_QUERY", "queries/tags.scm")

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "language",
    "inline_language",
    "HIGHLIGHTS_QUERY",
    "INJECTIONS_QUERY",
    "LOCALS_QUERY",
    "TAGS_QUERY",
]


def __dir__():
    return sorted(__all__ + [
        "__all__", "__builtins__", "__cached__", "__doc__", "__file__",
        "__loader__", "__name__", "__package__", "__path__", "__spec__",
    ])
