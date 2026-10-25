import Foundation

/// Everything that differs between one installation and another. Read once at start from a JSON file
/// (default /Users/Shared/MacTV/config.json, or --config <path>); every key is optional and falls back to
/// the default below. Nothing personal is ever compiled in: addresses are discovered, secrets live in the
/// keychain (holder) or in the host user's own Application Support (pairing tokens).
struct Config: Codable {
    /// TCP port the TV connects to (stream, commands, discovery, pairing).
    var port: UInt16 = 8810
    /// Loopback-only port for tools on this Mac (`mactv status`, `mactv pair`, ...). Never reachable from the LAN.
    var adminPort: UInt16 = 8813
    /// Loopback port of the holder's input relay (key and pointer events into the session).
    var holderPort: UInt16 = 8811
    /// Name the TV shows for this Mac.
    var name: String = Host.current().localizedName ?? "Mac"
    /// Refuse TVs that have not paired. Turn off only on a network you fully trust.
    var requirePairing: Bool = true
    /// Accept protocol-v0 receivers (no handshake, no token). Off by default: v0 has no authentication.
    var allowLegacy: Bool = false
    /// Upper bounds for the picture; the TV's reported decoder limits and link lower them further.
    var maxWidth: Int = 3840
    var maxHeight: Int = 2160
    var fps: Int = 60
    /// Average bitrates (bits per second) by link and picture size; adaptive control moves within [min, these].
    var bitrate4KWired: Int = 40_000_000
    var bitrate1080Wired: Int = 15_000_000
    var bitrateWifi: Int = 10_000_000
    var minBitrate: Int = 3_000_000
    /// On Wi-Fi, stay at 1080p even if the TV can decode 4K.
    var wifiMax1080: Bool = true
    /// Bundle identifiers whose windows are left out of the picture (they still draw in the session).
    var hiddenApps: [String] = ["com.apple.notificationcenterui"]
    /// Where logs, the runtime copies of scripts and app files live.
    var runtimeDir: String = "/Users/Shared/MacTV"
    /// The macOS user whose session the TV gets (the holder logs in as this user).
    var sessionUser: String = "mactv"
    /// Extra helper programs under apps/ the host keeps running as the session user (python3). Apps declare
    /// their own (`service` in app.json); this is for helpers that belong to no app.
    var services: [String] = []
    /// Web pages the TV can open ("app <name>"). Normally empty: apps describe themselves in
    /// <runtimeDir>/apps/<name>/app.json (docs/web-apps.md). An entry here adds an app or replaces one.
    var apps: [String: WebApp] = [:]
    /// If set, only these apps are offered, in this order of preference; otherwise every app found.
    var enabledApps: [String]? = nil

    /// The engine knows nothing about any particular site: everything app-specific is in this description.
    struct WebApp: Codable {
        /// Name the TV shows in its menu (defaults to the app's folder name).
        var title: String? = nil
        var url: String
        /// Chrome profile directory name under ~/Library/Application Support of the session user.
        var profile: String
        /// Page zoom: the screen is across the room.
        var scale: Int = 2
        var userAgent: String? = nil
        /// DevTools port (loopback only) used to keep the window full screen and, with `tvui`, to lay a
        /// TV interface over the page.
        var debugPort: Int? = nil
        /// A script under apps/ injected into the page (the TV interface), e.g. "music/tvui.js".
        var tvui: String? = nil
        /// The page is built for a remote (arrows, OK, back): the TV sends keys instead of a pointer.
        var remote: Bool = false
        /// Remote keys this page wants as other keystrokes, e.g. {"next": "n", "previous": "p"}.
        var keys: [String: String] = [:]
        /// TV commands this page handles itself: verb → a function on `window` (needs debugPort). The host calls
        /// it with the command's words as strings until it returns 'ok', e.g. {"play": "__tvuiPlay"}.
        var commands: [String: String] = [:]
        /// A function on `window` that takes text from the TV's keyboard directly (any language), e.g. "__tvuiText".
        var text: String? = nil
        /// A helper program under apps/ the host keeps running while installed, e.g. "music/feed.py".
        var service: String? = nil

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            title = try c.decodeIfPresent(String.self, forKey: .title)
            url = try c.decode(String.self, forKey: .url)
            profile = try c.decode(String.self, forKey: .profile)
            scale = try c.decodeIfPresent(Int.self, forKey: .scale) ?? 2
            userAgent = try c.decodeIfPresent(String.self, forKey: .userAgent)
            debugPort = try c.decodeIfPresent(Int.self, forKey: .debugPort)
            tvui = try c.decodeIfPresent(String.self, forKey: .tvui)
            remote = try c.decodeIfPresent(Bool.self, forKey: .remote) ?? false
            keys = try c.decodeIfPresent([String: String].self, forKey: .keys) ?? [:]
            commands = try c.decodeIfPresent([String: String].self, forKey: .commands) ?? [:]
            text = try c.decodeIfPresent(String.self, forKey: .text)
            service = try c.decodeIfPresent(String.self, forKey: .service)
        }
    }

    static func load(_ path: String) -> Config {
        var cfg = Config()
        if let data = FileManager.default.contents(atPath: path) {
            do { cfg = try JSONDecoder().decode(Config.self, from: data) }
            catch { log("config: \(path) unreadable (\(error)); using defaults") }
        }
        cfg.apps = discoverApps(in: "\(cfg.runtimeDir)/apps").merging(cfg.apps) { _, own in own }
        if let only = cfg.enabledApps { cfg.apps = cfg.apps.filter { only.contains($0.key) } }
        return cfg
    }

    /// Every <dir>/<name>/app.json. Paths inside one (tvui, service) are relative to its folder.
    static func discoverApps(in dir: String) -> [String: WebApp] {
        var found: [String: WebApp] = [:]
        for name in (try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? [] {
            guard let data = FileManager.default.contents(atPath: "\(dir)/\(name)/app.json") else { continue }
            do {
                var app = try JSONDecoder().decode(WebApp.self, from: data)
                app.tvui = app.tvui.map { "\(name)/\($0)" }
                app.service = app.service.map { "\(name)/\($0)" }
                found[name] = app
            } catch {
                log("app \(name): app.json unreadable (\(error)); skipped")
            }
        }
        return found
    }

    /// Helper programs to keep running: those of the offered apps, then the config's own.
    var allServices: [String] { apps.keys.sorted().compactMap { apps[$0]?.service } + services }
}

extension Config {
    // Missing keys fall back to the defaults above instead of failing the whole file.
    init(from decoder: Decoder) throws {
        self.init()
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func v<T: Decodable>(_ k: CodingKeys, _ cur: T) throws -> T { try c.decodeIfPresent(T.self, forKey: k) ?? cur }
        port = try v(.port, port)
        adminPort = try v(.adminPort, adminPort)
        holderPort = try v(.holderPort, holderPort)
        name = try v(.name, name)
        requirePairing = try v(.requirePairing, requirePairing)
        allowLegacy = try v(.allowLegacy, allowLegacy)
        maxWidth = try v(.maxWidth, maxWidth)
        maxHeight = try v(.maxHeight, maxHeight)
        fps = try v(.fps, fps)
        bitrate4KWired = try v(.bitrate4KWired, bitrate4KWired)
        bitrate1080Wired = try v(.bitrate1080Wired, bitrate1080Wired)
        bitrateWifi = try v(.bitrateWifi, bitrateWifi)
        minBitrate = try v(.minBitrate, minBitrate)
        wifiMax1080 = try v(.wifiMax1080, wifiMax1080)
        hiddenApps = try v(.hiddenApps, hiddenApps)
        runtimeDir = try v(.runtimeDir, runtimeDir)
        sessionUser = try v(.sessionUser, sessionUser)
        services = try v(.services, services)
        apps = try v(.apps, apps)
        enabledApps = try v(.enabledApps, enabledApps)
    }
}
