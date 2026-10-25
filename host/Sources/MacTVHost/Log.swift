import Foundation

/// One line per event, "HH:mm:ss message", to stdout (redirected to <runtimeDir>/host.log when running as an
/// app). The last events are also kept in memory for `mactv status`.
private let stamp: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "HH:mm:ss"
    return f
}()
private let logLock = NSLock()
private var recent: [String] = []

func log(_ items: Any...) {
    let line = stamp.string(from: Date()) + " " + items.map { "\($0)" }.joined(separator: " ")
    logLock.lock()
    print(line)
    recent.append(line)
    if recent.count > 50 { recent.removeFirst(recent.count - 50) }
    logLock.unlock()
}

func recentLog() -> [String] {
    logLock.lock(); defer { logLock.unlock() }
    return recent
}

/// Points stdout at the log file (appending) so print() and log() land there.
func redirectLog(to path: String) {
    try? FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
    freopen(path, "a", stdout)
    freopen(path, "a", stderr)
    setbuf(stdout, nil)
}
