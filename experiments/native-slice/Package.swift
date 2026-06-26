// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "NativeSlice",
    platforms: [.macOS(.v13)],
    dependencies: [
        // 1.1 — community fork shipping the prebuilt GhosttyKit.xcframework +
        // the HOST_MANAGED .inMemory backend patch. Pinned EXACT (not a range).
        .package(url: "https://github.com/Lakr233/libghostty-spm.git", exact: "1.2.7"),
        // 1.2 — native code editor (CodeEdit project): SwiftUI + AppKit,
        // tree-sitter highlighting, find/replace, built-in text diff. Pre-production → pin exact.
        // Note: 0.11.2 does not exist. 0.13.0+ pulls CodeEditSymbols@0.2.3 which has a Bundle.module
        // build error (xcassets not declared as SPM resource — broken under `swift build`).
        // 0.12.0 is the latest tag without that transitive dep. Its own Package.swift uses
        // CodeEditTextView "from: 0.10.1"; without an upper bound SPM resolves to 0.12.1 which
        // has breaking API changes. Explicit range below caps it at < 0.12.0 to stay compatible.
        .package(url: "https://github.com/CodeEditApp/CodeEditSourceEditor.git", exact: "0.12.0"),
        // Force CodeEditTextView to the exact version CodeEditSourceEditor 0.12.0 was built against.
        // 0.10.1 uses setLineFragment(_ fragment:) (1 param); 0.11.0+ changed the signature.
        .package(url: "https://github.com/CodeEditApp/CodeEditTextView.git", exact: "0.10.1"),
    ],
    targets: [
        .executableTarget(
            name: "NativeSlice",
            dependencies: [
                .product(name: "GhosttyTerminal", package: "libghostty-spm"),
                .product(name: "CodeEditSourceEditor", package: "CodeEditSourceEditor"),
            ],
            path: "Sources/NativeSlice"
        ),
        .testTarget(
            name: "NativeSliceTests",
            dependencies: ["NativeSlice"],
            path: "Tests/NativeSliceTests"
        ),
    ]
)
