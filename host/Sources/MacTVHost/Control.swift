import AppKit
import Foundation
import Network

/// X keysyms as Apple's Screen Sharing reads them. Command arrives as Alt_L and Option as Meta_L there.
enum Sym {
    static let command: UInt32 = 0xffe9, option: UInt32 = 0xffe7, control: UInt32 = 0xffe3, shift: UInt32 = 0xffe1
    static let up: UInt32 = 0xff52, down: UInt32 = 0xff54, left: UInt32 = 0xff51, right: UInt32 = 0xff53
    static let enter: UInt32 = 0xff0d, escape: UInt32 = 0xff1b, tab: UInt32 = 0xff09, space: UInt32 = 0x20
    static func char(_ c: Character) -> UInt32 { UInt32(c.unicodeScalars.first!.value) }
    /// Latin-1 keysyms are the code point itself; everything else is 0x01000000 + code point.
    static func text(_ c: Character) -> UInt32 {
        let v = c.unicodeScalars.first!.value
        return v < 0x100 ? v : 0x0100_0000 + v
    }
}

/// Key and pointer events into the session, through the holder's input relay (holder.py, loopback). They
/// arrive as Screen Sharing input, so no Accessibility permission is needed.
final class Injector {
    private let port: UInt16
    private let queue = DispatchQueue(label: "inject")
    private var conn: NWConnection?

    init(port: UInt16) { self.port = port }

    private func connection() -> NWConnection {
        if let c = conn, c.state == .ready || c.state == .preparing || c.state == .setup { return c }
        let c = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
        c.stateUpdateHandler = { [weak self] state in if case .failed = state { self?.queue.async { self?.conn = nil } } }
        c.start(queue: queue)
        conn = c
        return c
    }

    private func send(_ line: String) {
        queue.async { self.connection().send(content: Data((line + "\n").utf8), completion: .idempotent) }
    }

    /// Presses the keys in order and releases them in reverse (a chord such as Command-[). With `hold`, the
    /// keys stay down while it runs (Option held for a click).
    func chord(_ syms: [UInt32], hold: (() -> Void)? = nil) {
        for s in syms { send(String(format: "k %x 1", s)) }
        hold?()
        for s in syms.reversed() { send(String(format: "k %x 0", s)) }
    }

    /// Pointer in framebuffer pixels (twice the display's points) and button mask.
    func pointer(x: Int, y: Int, buttons: Int) { send("p \(x) \(y) \(buttons)") }

    /// Scroll by dy points (positive is down) with the pointer at (x, y) framebuffer pixels.
    func scroll(dy: Int, x: Int, y: Int) { send("s 0 \(dy) \(x) \(y)") }
}

/// The TV's commands, turned into what makes sense for the app in front (docs/protocol.md lists them).
final class Control {
    var sendStatus: ((Data) -> Void)?
    private let cfg: Config
    private let inject: Injector
    private let chromePath = "/Applications/Google Chrome.app"
    private let chromeBundle = "com.google.Chrome"
    /// Display points; the framebuffer is twice this.
    private var pointerX = 960.0, pointerY = 540.0
    private var displayPoints = (1920.0, 1080.0)
    private var openedWeb: String?
    private var lastStatus = Data()
    private var healing = false
    private(set) var lastHeal = "never"

    init(cfg: Config) {
        self.cfg = cfg
        inject = Injector(port: cfg.holderPort)
        if let s = NSScreen.main?.frame.size { displayPoints = (Double(s.width), Double(s.height)) }
        Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.reportStatus(force: false) }
    }

    private var front: String { NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "" }

    /// The web page in front. Normally the one last opened; after a restart nothing was opened yet, so the
    /// Chrome in front is recognised by its profile.
    private var currentWeb: String? {
        if let w = openedWeb { return w }
        guard let app = NSWorkspace.shared.frontmostApplication, app.bundleIdentifier == chromeBundle else { return nil }
        let args = processArguments(app.processIdentifier)
        openedWeb = cfg.apps.first { args.contains("--user-data-dir=\(profileDir($0.value.profile))") }?.key
        return openedWeb
    }

    func handle(_ line: String) {
        let parts = line.split(separator: " ").map(String.init)
        guard let verb = parts.first else { return }
        if verb != "move" && verb != "text" { log("command:", line) }
        switch verb {
        case "key" where parts.count > 1: key(parts[1])
        case "app" where parts.count > 1: open(parts[1])
        case "text" where parts.count > 1:
            // From the TV's own keyboard; base64 so spaces and any character survive the line protocol.
            guard let d = Data(base64Encoded: parts[1]), let text = String(data: d, encoding: .utf8) else { return }
            let enter = parts.count > 2 && parts[2] == "enter"
            if let name = currentWeb, front == chromeBundle, let fn = cfg.apps[name]?.text {
                // A page that takes text itself gets it directly: keystrokes can't carry Chinese and the like.
                let js = String(data: try! JSONSerialization.data(withJSONObject: [text]), encoding: .utf8)!
                cdp(app: name, ["eval", "window[\(jsString(fn))] && window[\(jsString(fn))](\(js)[0], \(enter))"])
                return
            }
            for c in text { inject.chord([c == "\n" ? Sym.enter : Sym.text(c)]) }
            if enter { inject.chord([Sym.enter]) }
        case "move" where parts.count > 2:
            pointerX = min(max(Double(parts[1]) ?? 0, 0), displayPoints.0 - 1)
            pointerY = min(max(Double(parts[2]) ?? 0, 0), displayPoints.1 - 1)
            inject.pointer(x: Int(pointerX * 2), y: Int(pointerY * 2), buttons: 0)
        case "click":
            let x = Int(pointerX * 2), y = Int(pointerY * 2)
            inject.pointer(x: x, y: y, buttons: 1)
            inject.pointer(x: x, y: y, buttons: 0)
        case "scroll" where parts.count > 1:
            // One step is about a mouse-wheel notch.
            let steps = max(-20, min(20, Int(parts[1]) ?? 0))
            inject.scroll(dy: steps * 30, x: Int(pointerX * 2), y: Int(pointerY * 2))
        case "fill":
            if let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier { fill(pid: pid) }
        default:
            // A command some page declared in its app.json ("commands"), e.g. "play albums 123 shuffle".
            if let (name, fn) = pageCommand(verb) {
                // Only plain words reach the page, as strings.
                let words = parts.dropFirst().map { $0.filter { $0.isLetter || $0.isNumber || ".-_:".contains($0) } }
                let js = String(data: try! JSONSerialization.data(withJSONObject: Array(words)), encoding: .utf8)!
                let f = "window[\(jsString(fn))]"
                // The page may still be loading, so keep trying for a while.
                evalUntilOK(app: name, "\(f) ? \(f)(...\(js)) : 'wait'")
            } else {
                log("unknown command:", line)
            }
        }
    }

    /// The app that handles a page command: the one in front if it does, else the first that declares it.
    private func pageCommand(_ verb: String) -> (String, String)? {
        if let name = openedWeb, let fn = cfg.apps[name]?.commands[verb] { return (name, fn) }
        for name in cfg.apps.keys.sorted() { if let fn = cfg.apps[name]?.commands[verb] { return (name, fn) } }
        return nil
    }

    private func jsString(_ s: String) -> String {
        String(data: try! JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)!.dropFirst().dropLast().description
    }

    // MARK: keys

    private func key(_ name: String) {
        let app = front
        let web = app == chromeBundle ? currentWeb : nil
        let remotePage = web.flatMap { cfg.apps[$0]?.remote } ?? false
        switch name {
        case "up": inject.chord([Sym.up])
        case "down": inject.chord([Sym.down])
        case "left": inject.chord([Sym.left])
        case "right": inject.chord([Sym.right])
        case "select": inject.chord([Sym.enter])
        case "back":
            // Remote-built pages go back with Escape; ordinary browser pages and Apple's apps with Command-[.
            if remotePage { inject.chord([Sym.escape]) }
            else if app == chromeBundle || app == "com.apple.TV" || app == "com.apple.Music" { inject.chord([Sym.command, Sym.char("[")]) }
            else { inject.chord([Sym.escape]) }
        case "playpause": inject.chord([Sym.space])
        case "next", "previous":
            // Pages name their own (app.json "keys"); otherwise skip forward and back with the arrows.
            if let k = web.flatMap({ cfg.apps[$0]?.keys[name] }), let c = k.first { inject.chord([Sym.char(c)]) }
            else { inject.chord([name == "next" ? Sym.right : Sym.left]) }
        default: log("unknown key:", name)
        }
    }

    // MARK: apps

    private func profileDir(_ profile: String) -> String {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/\(profile)").path
    }

    /// The running Chrome that owns a profile: its main process names that --user-data-dir and has no --type.
    private func chromeApp(profile: String) -> NSRunningApplication? {
        let dir = profileDir(profile)
        for app in NSRunningApplication.runningApplications(withBundleIdentifier: chromeBundle) where !app.isTerminated {
            let args = processArguments(app.processIdentifier)
            if args.contains("--user-data-dir=\(dir)") && !args.contains(where: { $0.hasPrefix("--type=") }) { return app }
        }
        return nil
    }

    private func open(_ name: String) {
        if name == "desktop" {
            for a in NSWorkspace.shared.runningApplications where a.activationPolicy == .regular && a.bundleIdentifier != "com.apple.finder" { a.hide() }
            NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first?.activate()
            return
        }
        guard let page = cfg.apps[name] else { log("unknown app:", name); return }
        openedWeb = name
        // One player at a time: the others would keep playing underneath, and both sounds would reach the TV.
        for (other, otherPage) in cfg.apps where otherPage.profile != page.profile {
            if let app = chromeApp(profile: otherPage.profile) {
                // Chrome ignores a polite terminate() from another app; SIGTERM makes it save and quit.
                log("closing", other)
                kill(app.processIdentifier, SIGTERM)
            }
        }
        // Each page has its own profile, so a running profile already shows this page: bring it forward.
        if let app = chromeApp(profile: page.profile) {
            app.activate()
            log("brought forward", name)
            afterShown(name, pid: app.processIdentifier)
            return
        }
        launch(name, page)
    }

    /// One Chrome window per page, in its own profile (sign-ins stay put), in kiosk mode: full screen, no title
    /// bar, no menu bar, so only the page reaches the TV.
    private func launch(_ name: String, _ page: Config.WebApp) {
        let cfgOpen = NSWorkspace.OpenConfiguration()
        cfgOpen.activates = true
        // A second Chrome process hands its arguments to a running one and quits; without a new instance
        // NSWorkspace would only bring the running Chrome forward and drop them.
        cfgOpen.createsNewApplicationInstance = true
        var args = ["--user-data-dir=\(profileDir(page.profile))", "--app=\(page.url)", "--force-device-scale-factor=\(page.scale)",
                    "--kiosk", "--deny-permission-prompts", "--disable-notifications",
                    "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--no-default-browser-check",
                    "--disable-features=Translate",
                    // The session user's login keychain is locked off the console: keep Chrome's secrets in the profile.
                    "--use-mock-keychain", "--password-store=basic",
                    // Off the console macOS reports the window as occluded and Chrome stops painting it.
                    "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"]
        if let ua = page.userAgent { args.append("--user-agent=\(ua)") }
        if let port = page.debugPort {
            args += ["--remote-debugging-port=\(port)", "--remote-debugging-address=127.0.0.1", "--remote-allow-origins=http://127.0.0.1"]
        }
        cfgOpen.arguments = args
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: chromePath), configuration: cfgOpen) { [weak self] _, error in
            if let error { log("open", name, "failed:", error.localizedDescription); return }
            log("opened", name)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                guard let self, let chrome = self.chromeApp(profile: page.profile) else { log("no window for", name); return }
                chrome.activate()
                self.afterShown(name, pid: chrome.processIdentifier)
            }
        }
    }

    private func afterShown(_ name: String, pid: pid_t) {
        if cfg.apps[name]?.tvui != nil { injectTVUI(name) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.fill(pid: pid); self.reportStatus(force: true) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { self.heal() }
    }

    // MARK: DevTools (tools/cdp.py)

    private func cdpProcess(app: String, _ args: [String]) -> Process? {
        guard let port = cfg.apps[app]?.debugPort else { return nil }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        p.arguments = ["\(cfg.runtimeDir)/tools/cdp.py"] + args
        p.environment = ["CDP_PORT": String(port)]
        p.standardError = FileHandle.nullDevice
        return p
    }

    private func cdp(app: String, _ args: [String]) {
        guard let p = cdpProcess(app: app, args) else { return }
        p.standardOutput = FileHandle.nullDevice
        try? p.run()
    }

    private func evalUntilOK(app: String, _ js: String, attempt: Int = 0) {
        guard let p = cdpProcess(app: app, ["eval", js]) else { return }
        let out = Pipe()
        p.standardOutput = out
        p.terminationHandler = { [weak self] proc in
            let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            if proc.terminationStatus == 0 && text.contains("ok") { log("page command done on", app); return }
            guard attempt < 20 else { log("page command on", app, "gave up"); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self?.evalUntilOK(app: app, js, attempt: attempt + 1) }
        }
        try? p.run()
    }

    private func injectTVUI(_ app: String, attempt: Int = 0) {
        guard let script = cfg.apps[app]?.tvui, let p = cdpProcess(app: app, ["inject", "\(cfg.runtimeDir)/apps/\(script)"]) else { return }
        p.standardOutput = FileHandle.nullDevice
        p.terminationHandler = { [weak self] proc in
            if proc.terminationStatus == 0 { log("tv interface on", app); return }
            guard attempt < 10 else { log("tv interface on", app, "gave up"); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self?.injectTVUI(app, attempt: attempt + 1) }
        }
        try? p.run()
    }

    /// Repairs the page in front (tools/cdp.py heal): full screen that macOS stopped presenting (the viewport
    /// comes up shorter than the screen while Chrome still believes it is full screen) and, on pages with a TV
    /// interface, a missing interface. Logs only what it fixed.
    func heal() {
        guard !healing, front == chromeBundle, let name = currentWeb, let page = cfg.apps[name], page.debugPort != nil else { return }
        let args = ["heal"] + (page.tvui.map { ["\(cfg.runtimeDir)/apps/\($0)"] } ?? [])
        guard let p = cdpProcess(app: name, args) else { return }
        healing = true
        let out = Pipe()
        p.standardOutput = out
        p.terminationHandler = { [weak self] _ in
            let text = (String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty && text != "ok" { log("heal \(name):", text) }
            DispatchQueue.main.async {
                self?.healing = false
                self?.lastHeal = ISO8601DateFormatter().string(from: Date()) + " " + (text.isEmpty ? "no answer" : text)
            }
        }
        do { try p.run() } catch { healing = false }
    }

    // MARK: windows

    private func mainWindow(pid: pid_t) -> CGRect? {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        return list.compactMap { w -> CGRect? in
            guard (w[kCGWindowOwnerPID as String] as? pid_t) == pid, (w[kCGWindowLayer as String] as? Int) == 0,
                  let b = w[kCGWindowBounds as String] as? [String: Double] else { return nil }
            return CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
        }.max { $0.width * $0.height < $1.width * $1.height }
    }

    /// Makes the front window fill the screen with an Option-click on its green button (macOS's zoom). Real
    /// full screen (Control-Command-F, a plain green click) does nothing in an off-console session, which has
    /// no Spaces. The button sits a little differently per app, so a few offsets are tried in turn.
    private func fill(pid: pid_t, attempt: Int = 0) {
        let offsets: [(Double, Double)] = [(70, 25), (68, 16), (60, 12)]
        guard let r = mainWindow(pid: pid) else { return }
        if r.width >= displayPoints.0 - 10 && r.height >= displayPoints.1 - 60 { return }
        guard attempt < offsets.count else { log("fill: gave up", r); return }
        let x = Int((r.minX + offsets[attempt].0) * 2), y = Int((r.minY + offsets[attempt].1) * 2)
        inject.pointer(x: x, y: y, buttons: 0)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.inject.chord([Sym.option]) { self.inject.pointer(x: x, y: y, buttons: 1); self.inject.pointer(x: x, y: y, buttons: 0) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.fill(pid: pid, attempt: attempt + 1) }
    }

    // MARK: status

    /// A page asks for the TV's keyboard by putting ⌨ in its window title; Chrome wraps
    /// the title in quotes and adds a speaker while sound plays, so look anywhere in it.
    private func keyboardWanted() -> Bool {
        guard front == chromeBundle, let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier,
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return false }
        return list.contains { ($0[kCGWindowOwnerPID as String] as? pid_t) == pid && (($0[kCGWindowName as String] as? String) ?? "").contains("⌨") }
    }

    func statusObject() -> [String: Any] {
        let f = front
        let web = f == chromeBundle ? currentWeb : nil
        let app = web ?? (f == "com.apple.finder" ? "desktop" : f == chromeBundle ? "web" : "other")
        return ["front": f, "app": app, "remote": web.flatMap { cfg.apps[$0]?.remote } ?? false, "keyboard": keyboardWanted()]
    }

    /// Status (packet 5) whenever it changes, and on request (a new receiver).
    func reportStatus(force: Bool) {
        let d = (try? JSONSerialization.data(withJSONObject: statusObject(), options: [.sortedKeys])) ?? Data()
        guard force || d != lastStatus else { return }
        lastStatus = d
        sendStatus?(d)
    }
}

/// A process's arguments (KERN_PROCARGS2).
func processArguments(_ pid: pid_t) -> [String] {
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
    var size = 0
    guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 4 else { return [] }
    var buf = [UInt8](repeating: 0, count: size)
    guard sysctl(&mib, 3, &buf, &size, nil, 0) == 0 else { return [] }
    let argc = Int(buf.withUnsafeBytes { $0.load(as: Int32.self) })
    var i = 4
    while i < size && buf[i] != 0 { i += 1 }        // executable path
    while i < size && buf[i] == 0 { i += 1 }        // padding
    var args: [String] = []
    while args.count < argc && i < size {
        let start = i
        while i < size && buf[i] != 0 { i += 1 }
        args.append(String(decoding: buf[start..<i], as: UTF8.self))
        i += 1
    }
    return args
}
