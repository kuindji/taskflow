// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "NativeSpike",
    platforms: [
        .macOS(.v13),
    ],
    dependencies: [
        .package(url: "https://github.com/Lakr233/libghostty-spm.git", from: "1.2.0"),
    ],
    targets: [
        .executableTarget(
            name: "NativeSpike",
            dependencies: [
                .product(name: "GhosttyTerminal", package: "libghostty-spm"),
            ],
            path: "Sources/NativeSpike"
        ),
    ]
)
