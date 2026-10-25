// MacTV host. Runs inside the dedicated macOS session (normally as MacTVHost.app, started by launchd with
// the session) and serves that session to the TV: its display as HEVC/H.264, its sound, its pointer and
// keys. See docs/architecture.md for the whole picture and docs/protocol.md for the wire format.
//
// Usage: MacTVHost [--config <file>] [--test] [--foreground] [--port N] [--admin-port N] [--state-dir <dir>]
//   --test         test pattern and tone instead of the screen and the session's sound (any Mac, no permissions)
//   --foreground   log to the terminal instead of <runtimeDir>/host.log
import AppKit
import Darwin
import Foundation

let version = "1.0.0"
var args = Array(CommandLine.arguments.dropFirst())
func option(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}
// Started from another program, an inherited stdin kept the listener and tasks from ever starting; the host
// never reads it, so it always gets /dev/null (as under launchd).
freopen("/dev/null", "r", stdin)
let testMode = args.contains("--test")
var cfg = Config.load(option("--config") ?? "/Users/Shared/MacTV/config.json")
if let p = option("--port").flatMap(UInt16.init) { cfg.port = p }
if let p = option("--admin-port").flatMap(UInt16.init) { cfg.adminPort = p }
if !args.contains("--foreground") { redirectLog(to: "\(cfg.runtimeDir)/host.log") }
setvbuf(stdout, nil, _IOLBF, 0)  // a line at a time, also when stdout is a pipe or a file
let stateDir = option("--state-dir")
    ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/MacTV").path

log("MacTV host", version, "starting, uid", getuid(), testMode ? "(test mode)" : "")
let started = Date()
let pairing = Pairing(directory: stateDir)
let transport = Transport(cfg: cfg, pairing: pairing)
let encoder = VideoEncoder()
let controller = BitrateController(encoder: encoder, minimum: cfg.minBitrate)
let screen: ScreenSource? = testMode ? nil : ScreenSource(hiddenApps: cfg.hiddenApps)
let source: PictureSource = screen ?? TestSource()
let sound: SoundSource = testMode ? TestTone() : SessionAudio()
let control = Control(cfg: cfg)
let admin = Admin(port: cfg.adminPort)
let services = Services(cfg: cfg)

// MARK: wiring

transport.onReceiver = { hello, kind, local in
    let v = kind == "legacy" ? legacyVideo(cfg) : negotiate(hello, cfg, sourceWidth: source.naturalSize.0, sourceHeight: source.naturalSize.1)
    encoder.configure(v)
    // Not here on the transport queue: the source's own thread may be waiting on the transport.
    DispatchQueue.main.async {
        source.resize(width: v.width, height: v.height, fps: v.fps)
        control.reportStatus(force: true)
    }
    return Welcome(host: cfg.name, video: v, wake: local.flatMap { hardwareAddress(forIP: $0) }, apps: cfg.apps.keys.sorted(),
                   titles: cfg.apps.compactMapValues(\.title))
}
transport.onLine = { line in
    // The TV fell behind and dropped frames: a fresh key frame resyncs it without waiting for the next one.
    if line == "keyframe" { encoder.requestKeyFrame(); return }
    DispatchQueue.main.async { control.handle(line) }
}
encoder.emit = { type, pts, data in
    // Up to about a second of video may wait; beyond that plain frames are dropped until the next key frame.
    transport.send(type, pts: pts, payload: data, budget: max(1 << 20, encoder.bitrate / 8))
}
source.onPicture = { pixels in
    if transport.hasReceiver { encoder.encode(pixels) } else { encoder.keep(pixels) }
}
sound.onSound = { data in transport.send(.audio, pts: nowMicros(), payload: data, budget: .max) }
control.sendStatus = { data in transport.send(.status, pts: nowMicros(), payload: data, budget: .max) }
screen?.onRestart = {
    encoder.requestKeyFrame()
    // A reconfigured display is when windows drop out of full screen.
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { control.heal() }
}

admin.handle = { line in
    let parts = line.split(separator: " ").map(String.init)
    switch parts.first ?? "" {
    case "status":
        return ["version": version, "protocol": protocolVersion, "testMode": testMode,
                "uptimeSeconds": Int(Date().timeIntervalSince(started)),
                "config": ["port": Int(cfg.port), "requirePairing": cfg.requirePairing, "allowLegacy": cfg.allowLegacy, "name": cfg.name],
                "receiver": transport.stats(), "video": encoder.status(), "picture": source.status(), "sound": sound.status(),
                "front": control.statusObject(), "lastHeal": control.lastHeal, "services": services.status(),
                "pairing": ["windowOpen": pairing.windowOpen, "devices": pairing.list().count], "log": recentLog()]
    case "pair":
        let seconds = parts.count > 1 ? max(30, min(600, Int(parts[1]) ?? 120)) : 120
        return ["pin": pairing.open(seconds: seconds), "seconds": seconds]
    case "devices":
        return ["devices": pairing.list()]
    case "unpair" where parts.count > 1:
        return ["removed": pairing.unpair(parts[1])]
    case "keyframe":
        encoder.requestKeyFrame()
        return ["ok": true]
    case "heal":
        control.heal()
        return ["ok": true]
    case "filter" where parts.count > 1 && screen != nil:
        screen!.hiding = parts[1] != "off"
        screen!.refreshFilter(force: true)
        return ["hiding": screen!.hiding]
    case "restart":
        log("restart requested")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) }
        return ["ok": true]
    default:
        return ["error": "unknown command", "commands": ["status", "pair [seconds]", "devices", "unpair <id|all>", "keyframe", "heal", "filter on|off", "restart"]]
    }
}

// MARK: start

do {
    try transport.start()
    try admin.start()
} catch {
    log("cannot listen:", error)
    exit(2)
}
Task {
    do {
        try await source.start(width: min(cfg.maxWidth, 1920), height: min(cfg.maxHeight, 1080), fps: cfg.fps)
    } catch {
        log("capture failed:", error.localizedDescription, "(Screen Recording allowed for MacTVHost in this session?)")
        exit(3)
    }
}
sound.start()
if !testMode { services.start() }

let repeatTimer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "repeat"))
repeatTimer.schedule(deadline: .now(), repeating: 0.1)
repeatTimer.setEventHandler { if transport.hasReceiver { encoder.repeatIfIdle() } }
repeatTimer.resume()
let rateTimer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "rate"))
rateTimer.schedule(deadline: .now() + 1, repeating: 0.5)
rateTimer.setEventHandler { if transport.hasReceiver { controller.check(backlog: transport.backlog) } }
rateTimer.resume()
// Rounds while a TV watches: things drift with nobody touching them, and nobody at the TV can fix them.
Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { _ in if transport.hasReceiver { control.heal() } }
Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in screen?.refreshFilter() }
signal(SIGTERM) { _ in services.stopAll(); exit(0) }
// A run loop, not dispatchMain: NSWorkspace only updates the frontmost app with one.
RunLoop.main.run()

// MARK: helpers

/// The hardware address of the interface that owns `ip`, for Wake-on-LAN ("aa:bb:cc:dd:ee:ff").
func hardwareAddress(forIP ip: String) -> String? {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0, let first = list else { return nil }
    defer { freeifaddrs(list) }
    var name: String?
    var p: UnsafeMutablePointer<ifaddrs>? = first
    while let a = p {
        if let sa = a.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) {
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
            if String(cString: host) == ip { name = String(cString: a.pointee.ifa_name) }
        }
        p = a.pointee.ifa_next
    }
    guard let name else { return nil }
    p = first
    while let a = p {
        if String(cString: a.pointee.ifa_name) == name, let sa = a.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_LINK) {
            return sa.withMemoryRebound(to: sockaddr_dl.self, capacity: 1) { dl -> String? in
                let d = dl.pointee
                guard d.sdl_alen == 6 else { return nil }
                // sdl_data holds the interface name, then the address; it can run past the declared 12 bytes.
                let mac = UnsafeRawPointer(dl).advanced(by: MemoryLayout<sockaddr_dl>.offset(of: \sockaddr_dl.sdl_data)! + Int(d.sdl_nlen))
                return (0..<6).map { String(format: "%02x", mac.load(fromByteOffset: $0, as: UInt8.self)) }.joined(separator: ":")
            }
        }
        p = a.pointee.ifa_next
    }
    return nil
}
