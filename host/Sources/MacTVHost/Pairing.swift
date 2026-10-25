import Foundation
import Security

/// Which TVs may connect. A TV gets a token once, by typing a six-digit PIN that `mactv pair` shows on the
/// Mac while a pairing window is open; it then presents the token in every HELLO. Tokens are kept in the
/// session user's own Application Support (mode 600), never in the config or the repository.
final class Pairing {
    struct Device: Codable { var name: String; var created: Date; var lastSeen: Date? }

    private let path: String
    private let lock = NSLock()
    private var devices: [String: Device] = [:]
    private var pin: String?
    private var until = Date.distantPast
    private var failures = 0

    init(directory: String) {
        try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        path = (directory as NSString).appendingPathComponent("paired.json")
        if let d = FileManager.default.contents(atPath: path), let list = try? JSONDecoder().decode([String: Device].self, from: d) {
            devices = list
        }
    }

    private func save() {
        guard let d = try? JSONEncoder().encode(devices) else { return }
        FileManager.default.createFile(atPath: path, contents: d, attributes: [.posixPermissions: 0o600])
    }

    /// Opens a pairing window and returns its PIN.
    func open(seconds: Int) -> String {
        lock.lock(); defer { lock.unlock() }
        pin = String(format: "%06d", Int(Pairing.random32() % 1_000_000))
        until = Date().addingTimeInterval(TimeInterval(seconds))
        failures = 0
        return pin!
    }

    var windowOpen: Bool { lock.lock(); defer { lock.unlock() }; return pin != nil && Date() < until }

    /// A TV's PAIR request: the token, or the reason it is refused. Five wrong PINs close the window.
    func pair(pin attempt: String, name: String) -> (token: String?, reason: String?) {
        lock.lock(); defer { lock.unlock() }
        guard let pin, Date() < until else { return (nil, "no-window") }
        guard attempt == pin else {
            failures += 1
            if failures >= 5 { self.pin = nil }
            return (nil, "wrong-pin")
        }
        self.pin = nil
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let token = bytes.map { String(format: "%02x", $0) }.joined()
        devices[token] = Device(name: String(name.prefix(64)), created: Date(), lastSeen: nil)
        save()
        log("paired:", name)
        return (token, nil)
    }

    /// The device name for a valid token, recording that it was seen.
    func check(_ token: String?) -> String? {
        guard let token else { return nil }
        lock.lock(); defer { lock.unlock() }
        guard var d = devices[token] else { return nil }
        d.lastSeen = Date()
        devices[token] = d
        save()
        return d.name
    }

    /// Paired devices as (short id, name, last seen), for `mactv devices`. The id is a token prefix, enough to
    /// unpair with and useless to connect with.
    func list() -> [[String: String]] {
        lock.lock(); defer { lock.unlock() }
        let f = ISO8601DateFormatter()
        return devices.map { ["id": String($0.key.prefix(8)), "name": $0.value.name, "lastSeen": $0.value.lastSeen.map(f.string) ?? "never"] }
    }

    /// Forgets devices whose token starts with `id`, or all with "all". Returns how many went.
    func unpair(_ id: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        let before = devices.count
        if id == "all" { devices = [:] } else { devices = devices.filter { !$0.key.hasPrefix(id) } }
        save()
        return before - devices.count
    }

    private static func random32() -> UInt32 {
        var v: UInt32 = 0
        _ = withUnsafeMutableBytes(of: &v) { SecRandomCopyBytes(kSecRandomDefault, 4, $0.baseAddress!) }
        return v
    }
}
