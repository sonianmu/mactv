import Foundation
import Network

/// Tools on this Mac talk to the host here: one line in, one JSON object out, then the connection closes.
/// Bound to loopback only, so nothing on the network can reach it; this is also why a tool never takes the
/// TV's place on the stream port.
///
///   status              everything `mactv status` shows
///   pair [seconds]      opens a pairing window (default 120 s): {"pin": "123456", "seconds": 120}
///   devices             paired TVs
///   unpair <id|all>     forgets TVs whose token starts with id
///   keyframe            sends a key frame now
///   heal                runs the self-repair round now
///   filter on|off       hides/shows the hidden apps (to check that hiding works)
///   restart             exits; launchd starts the host again (e.g. to pick up a new build)
final class Admin {
    private let port: UInt16
    private let queue = DispatchQueue(label: "admin")
    private var listener: NWListener?
    var handle: ((String) -> [String: Any])?

    init(port: UInt16) { self.port = port }

    func start() throws {
        let p = NWParameters.tcp
        p.requiredInterfaceType = .loopback
        let l = try NWListener(using: p, on: NWEndpoint.Port(rawValue: port)!)
        l.newConnectionHandler = { [weak self] c in self?.serve(c) }
        l.start(queue: queue)
        listener = l
    }

    private func serve(_ c: NWConnection) {
        // Belt and braces: refuse anything that is not from this Mac.
        if case let .hostPort(host, _) = c.endpoint, !(host == .ipv4(.loopback) || host == .ipv6(.loopback) || "\(host)".hasPrefix("127.")) {
            c.cancel()
            return
        }
        c.start(queue: queue)
        c.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, _, _ in
            let line = String(decoding: data ?? Data(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            let reply = DispatchQueue.main.sync { self?.handle?(line) ?? ["error": "not ready"] }
            let out = (try? JSONSerialization.data(withJSONObject: reply, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
            c.send(content: out + Data("\n".utf8), completion: .contentProcessed { _ in c.cancel() })
        }
    }
}
