// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TreeSitterMarkdown",
    platforms: [.macOS(.v10_13), .iOS(.v11)],
    products: [
        .library(name: "TreeSitterMarkdown", targets: ["TreeSitterMarkdown", "TreeSitterMarkdownInline"]),
    ],
    dependencies: [
        .package(url: "https://github.com/tree-sitter/swift-tree-sitter", exact: "0.10.0"),
    ],
    targets: [
        .target(
            name: "TreeSitterMarkdown",
            path: "tree-sitter-markdown",
            sources: [
                "src/parser.c",
                "src/scanner.c",
            ],
            resources: [
                .copy("queries")
            ],
            publicHeadersPath: "bindings/swift",
            cSettings: [.headerSearchPath("src")]
        ),
        .target(
            name: "TreeSitterMarkdownInline",
            path: "tree-sitter-markdown-inline",
            exclude: [
                "test",
                "grammar.js",
            ],
            sources: [
                "src/parser.c",
                "src/scanner.c",
            ],
            resources: [
                .copy("queries")
            ],
            publicHeadersPath: "bindings/swift",
            cSettings: [.headerSearchPath("src")]
        ),
        .testTarget(
            name: "TreeSitterMarkdownTests",
            dependencies: [
                .product(name: "SwiftTreeSitter", package: "swift-tree-sitter"),
                "TreeSitterMarkdown",
                "TreeSitterMarkdownInline",
            ],
            path: "bindings/swift/TreeSitterMarkdownTests"
        )
    ],
    cLanguageStandard: .c11
)
