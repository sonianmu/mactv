import Foundation

/// Helper programs (apps' `service` and config "services", paths under <runtimeDir>/apps) kept running beside the host, as the
/// same user: started at launch, started again 5 s after they exit, stopped when the host exits.
final class Services {
    private let cfg: Config
    private var running: [String: Process] = [:]
    private var stopping = false

    init(cfg: Config) { self.cfg = cfg }

    func start() {
        for s in cfg.allServices { launch(s) }
        atexit { services.stopAll() }
    }

    private func launch(_ name: String) {
        let path = "\(cfg.runtimeDir)/apps/\(name)"
        guard FileManager.default.fileExists(atPath: path) else { log("service missing:", path); return }
        let logPath = "\(cfg.runtimeDir)/\((name as NSString).deletingPathExtension.replacingOccurrences(of: "/", with: "-")).log"
        if !FileManager.default.fileExists(atPath: logPath) { FileManager.default.createFile(atPath: logPath, contents: nil) }
        let out = FileHandle(forWritingAtPath: logPath) ?? FileHandle.nullDevice
        out.seekToEndOfFile()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        p.arguments = ["-u", path]
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = out
        p.standardError = out
        p.terminationHandler = { [weak self] _ in
            guard let self, !self.stopping else { return }
            log("service", name, "exited; starting it again")
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.launch(name) }
        }
        do { try p.run(); running[name] = p; log("service", name, "started") } catch { log("service", name, "failed:", error) }
    }

    func stopAll() {
        stopping = true
        for p in running.values where p.isRunning { p.terminate() }
    }

    func status() -> [String: Bool] { running.mapValues(\.isRunning) }
}
