// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Taskflow",
    platforms: [.macOS(.v14)],
    dependencies: [
        // Terminal (Phase 4). Community fork shipping prebuilt GhosttyKit.xcframework +
        // the HOST_MANAGED .inMemory backend patch. Pinned EXACT — this version is load-bearing.
        .package(url: "https://github.com/Lakr233/libghostty-spm.git", exact: "1.2.7"),
        // Native code editor (Phase 4). Pre-production; 0.12.0 is the last tag that builds under
        // `swift build` (0.13.0+ hit an upstream CodeEditSymbols Bundle.module xcassets bug).
        .package(url: "https://github.com/CodeEditApp/CodeEditSourceEditor.git", exact: "0.12.0"),
        // Force the exact CodeEditTextView 0.12.0 was built against (0.11.0+ changed an API).
        .package(url: "https://github.com/CodeEditApp/CodeEditTextView.git", exact: "0.10.1"),
    ],
    targets: [
        .executableTarget(
            name: "Taskflow",
            dependencies: [
                .product(name: "GhosttyTerminal", package: "libghostty-spm"),
                .product(name: "CodeEditSourceEditor", package: "CodeEditSourceEditor"),
            ],
            path: "Sources/Taskflow",
            resources: [.copy("Resources/themes"), .copy("Resources/backend")],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "TaskflowTests",
            dependencies: ["Taskflow"],
            path: "Tests/TaskflowTests",
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
