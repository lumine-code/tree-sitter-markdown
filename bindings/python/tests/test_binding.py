from unittest import TestCase
import subprocess
import sys

import tree_sitter_markdown
from tree_sitter import Language, Parser


class TestLanguage(TestCase):
    def test_can_load_block_grammar(self):
        try:
            Parser(Language(tree_sitter_markdown.language()))
        except Exception:
            self.fail("Error loading Markdown block grammar")

    def test_can_load_inline_grammar(self):
        try:
            Parser(Language(tree_sitter_markdown.inline_language()))
        except Exception:
            self.fail("Error loading Markdown inline grammar")

    def test_queries_are_packaged(self):
        self.assertIn("@", tree_sitter_markdown.HIGHLIGHTS_QUERY)
        self.assertIn("injection", tree_sitter_markdown.INJECTIONS_QUERY)

    def test_pending_delimiter_plans_are_invalidated_by_edits_to_either_run(self):
        parser = Parser(Language(tree_sitter_markdown.inline_language()))

        def point_at(source, index):
            lines = source[:index].split(b"\n")
            return (len(lines) - 1, len(lines[-1]))

        def snapshot(tree):
            nodes = []
            pending = [tree.root_node]
            while pending:
                node = pending.pop()
                nodes.append((node.type, node.start_byte, node.end_byte,
                              tuple(node.start_point), tuple(node.end_point), node.child_count))
                pending.extend(reversed(node.children))
            return nodes

        for delimiter in (b"*", b"_"):
            for length in (16, 31, 254, 1024):
                for both in (False, True):
                    prefix = b"prefix\n(" if both else b"prefix\n"
                    body = b"!alpha!" if both else b"alpha"
                    run = delimiter * length
                    suffix = b")\nsuffix" if both else b"\nsuffix"
                    before = prefix + run + body + run + suffix
                    opener = len(prefix) + length // 2
                    closer = len(prefix) + length + len(body) + length // 2
                    for name, start, removed, inserted in (
                        ("extend opener", opener, 0, delimiter),
                        ("shorten opener", opener, 1, b""),
                        ("split opener", opener, 1, b"x"),
                        ("extend closer", closer, 0, delimiter),
                        ("shorten closer", closer, 1, b""),
                        ("escape closer", closer, 0, b"\\"),
                    ):
                        with self.subTest(delimiter=delimiter, length=length, both=both, edit=name):
                            old_tree = parser.parse(before)
                            self.assertFalse(old_tree.root_node.has_error)
                            after = before[:start] + inserted + before[start + removed:]
                            old_tree.edit(
                                start_byte=start,
                                old_end_byte=start + removed,
                                new_end_byte=start + len(inserted),
                                start_point=point_at(before, start),
                                old_end_point=point_at(before, start + removed),
                                new_end_point=point_at(after, start + len(inserted)),
                            )
                            incremental = parser.parse(after, old_tree)
                            fresh = parser.parse(after)
                            self.assertFalse(fresh.root_node.has_error)
                            self.assertFalse(incremental.root_node.has_error)
                            self.assertEqual(snapshot(incremental), snapshot(fresh))

    def test_large_document_node_traversal(self):
        # Upstream #251 parsed successfully before crashing during traversal
        # with py-tree-sitter 0.26.0, beginning around 10 KB of source.
        pattern = b"# Heading\n\n```{python}\nx = 1\ny = x + 1\n```\n\n"
        parser = Parser(Language(tree_sitter_markdown.language()))
        for length in (15_000, 150_000):
            with self.subTest(length=length):
                source = (pattern * (length // len(pattern) + 1))[:length]
                tree = parser.parse(source)
                stack = [tree.root_node]
                blocks = 0
                while stack:
                    node = stack.pop()
                    self.assertLessEqual(node.start_byte, node.end_byte)
                    self.assertLessEqual(node.end_byte, len(source))
                    self.assertLessEqual(node.start_point, node.end_point)
                    if node.type == "fenced_code_block":
                        blocks += 1
                    stack.extend(node.children)
                self.assertEqual(blocks, source.count(b"```{python}"))

    def test_unsafe_runtime_is_rejected_without_importing_it(self):
        result = subprocess.run(
            [sys.executable, "-c", """
from unittest.mock import patch
import sys
with patch('importlib.metadata.version', return_value='0.26.0'):
    try:
        import tree_sitter_markdown
    except ImportError as exc:
        assert '0.26.0 can crash' in str(exc), str(exc)
        assert 'tree-sitter>=0.25.2,<0.27,!=0.26.0' in str(exc), str(exc)
    else:
        raise AssertionError('Unsafe runtime was accepted')
assert 'tree_sitter' not in sys.modules
"""],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_capsule_api_remains_optional_without_runtime(self):
        result = subprocess.run(
            [sys.executable, "-c", """
from importlib.metadata import PackageNotFoundError
from unittest.mock import patch
import sys
with patch('importlib.metadata.version', side_effect=PackageNotFoundError):
    import tree_sitter_markdown
    assert tree_sitter_markdown.language() is not None
    assert tree_sitter_markdown.inline_language() is not None
assert 'tree_sitter' not in sys.modules
"""],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
