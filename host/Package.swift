// swift-tools-version:5.10
// The MacTV host: runs inside the dedicated macOS session and serves it to the TV (see docs/architecture.md).
import PackageDescription

let package = Package(
    name: "MacTVHost",
    platforms: [.macOS("14.2")],
    targets: [
        .executableTarget(
            name: "MacTVHost",
            path: "Sources/MacTVHost",
            linkerSettings: [
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("VideoToolbox"),
                .linkedFramework("CoreAudio"),
                .linkedFramework("AudioToolbox"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("Network"),
                .linkedFramework("AppKit"),
            ]
        ),
    ],
    swiftLanguageVersions: [.v5]
)
