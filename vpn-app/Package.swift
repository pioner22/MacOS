// swift-tools-version: 5.7
import PackageDescription

// Sparkle 2.10 requires macOS 12. Keep the Big Sur-compatible 2.9.6 revision.
// Its binary artifact is independently checksum-verified by SwiftPM.
var dependencies: [Package.Dependency] = []
var products: [Product] = [.library(name: "UpdatePolicy", targets: ["UpdatePolicy"])]
var targets: [Target] = [
    .target(name: "UpdatePolicy"),
    .testTarget(name: "UpdatePolicyTests", dependencies: ["UpdatePolicy"])
]
#if os(macOS)
dependencies.append(.package(
    url: "https://github.com/sparkle-project/Sparkle",
    revision: "ac2def288cbff5cfc7df3ffef6abdf45b72bcb0a"
))
products.append(.executable(name: "BigSurVPNApp", targets: ["BigSurVPNApp"]))
targets.append(.executableTarget(
    name: "BigSurVPNApp",
    dependencies: ["UpdatePolicy", .product(name: "Sparkle", package: "Sparkle")],
    linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]
))
#endif

let package = Package(
    name: "BigSurVPNApp",
    platforms: [.macOS(.v11)],
    products: products,
    dependencies: dependencies,
    targets: targets,
    swiftLanguageVersions: [.v5]
)
