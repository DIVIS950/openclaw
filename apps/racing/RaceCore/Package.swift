// swift-tools-version:5.9
import PackageDescription

// RaceCore: platform-independent timing, delta, fusion, parsing and analysis engine.
// No UIKit/CoreLocation imports so it can be unit-tested on macOS/Linux.
let package = Package(
    name: "RaceCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "RaceCore", targets: ["RaceCore"]),
    ],
    targets: [
        .target(name: "RaceCore", path: "Sources/RaceCore"),
        .testTarget(name: "RaceCoreTests", dependencies: ["RaceCore"], path: "Tests/RaceCoreTests"),
    ]
)
