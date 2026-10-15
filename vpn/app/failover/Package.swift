// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "ConnectionPolicy",
    platforms: [.macOS(.v11)],
    products: [.library(name: "ConnectionPolicy", targets: ["ConnectionPolicy"])],
    targets: [
        .target(name: "ConnectionPolicy"),
        .testTarget(name: "ConnectionPolicyTests", dependencies: ["ConnectionPolicy"])
    ],
    swiftLanguageVersions: [.v5]
)
