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
        assert 'tree-sitter>=0.25.2,<0.26' in str(exc), str(exc)
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
