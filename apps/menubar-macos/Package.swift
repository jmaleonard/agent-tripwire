// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TripwireMenubar",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "TripwireMenubar",
            path: "Sources/TripwireMenubar"
        )
    ]
)
