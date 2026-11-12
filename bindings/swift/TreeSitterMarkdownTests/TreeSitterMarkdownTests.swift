import XCTest
import SwiftTreeSitter
import TreeSitterMarkdown
import TreeSitterMarkdownInline

final class TreeSitterXMLTests: XCTestCase {
    func testCanLoadBlockGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_markdown())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Markdown block grammar")

        let tree = try XCTUnwrap(parser.parse("# Heading\n\n- item\n"))
        let root = try XCTUnwrap(tree.rootNode)
        XCTAssertFalse(root.hasError)
        XCTAssertEqual(root.nodeType, "document")
        let syntax = try XCTUnwrap(root.sExpressionString)
        XCTAssertTrue(syntax.contains("(atx_heading"))
        XCTAssertTrue(syntax.contains("(list_item"))
    }

    func testCanLoadInlineGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_markdown_inline())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Markdown inline grammar")

        let tree = try XCTUnwrap(parser.parse("**strong** and `code`"))
        let root = try XCTUnwrap(tree.rootNode)
        XCTAssertFalse(root.hasError)
        XCTAssertEqual(root.nodeType, "inline")
        let syntax = try XCTUnwrap(root.sExpressionString)
        XCTAssertTrue(syntax.contains("(strong_emphasis"))
        XCTAssertTrue(syntax.contains("(code_span"))
    }
}
