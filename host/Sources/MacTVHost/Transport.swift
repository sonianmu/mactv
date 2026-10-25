import Foundation
import Network

/// The TV's port. Sorts every new connection by its first line (Protocol.swift) and keeps one active
/// receiver, to which the media packets go and from which commands come.
final class Transport {
    /// A receiver passed the handshake (hello, "v1" or "legacy", the Mac's own address on that connection);
    /// returns the Welcome to send. Called on the transport queue: don't call back into Transport synchronously.
    var onReceiver: ((Hello, String, String?) -> Welcome)?
    var onLine: ((String) -> Void)?
    var onGone: (() -> Void)?

    private let cfg: Config
    private let pairing: Pairing
    private let queue = DispatchQueue(label: "transport")
    private var listener: NWListener?
    private var active: NWConnection? { didSet { flagLock.lock(); activeFlag = active != nil; flagLock.unlock() } }
    // Whether a receiver is connected, readable from any thread without touching `queue` (capture and audio
    // threads ask for every frame; waiting on the queue there could deadlock against the handshake).
    private let flagLock = NSLock()
    private var activeFlag = false
    private var inbox = Data()
    private var waitingForKey = true

    // Statistics for `mactv status` and the bitrate controller. Touched on `queue` only.
    private(set) var pending = 0
    private var sentBytes = 0, sentFrames = 0, dropped = 0
    private(set) var client: [String: String] = [:]
    private var since = Date()

    init(cfg: Config, pairing: Pairing) {
        self.cfg = cfg
        self.pairing = pairing
    }

    func start() throws {
        let p = NWParameters.tcp
        (p.defaultProtocolStack.transportProtocol as? NWProtocolTCP.Options)?.noDelay = true
        // Never through a VPN tunnel (interface type .other): a full-tunnel VPN would carry the TV's
        // connection away from the home network. Wi-Fi, Ethernet and loopback (tests) stay allowed.
        p.prohibitedInterfaceTypes = [.other]
        let l = try NWListener(using: p, on: NWEndpoint.Port(rawValue: cfg.port)!)
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.stateUpdateHandler = { state in if case .failed(let e) = state { log("listener failed:", e); exit(4) } }
        l.start(queue: queue)
        listener = l
        log("listening on", cfg.port)
    }

    // MARK: sorting new connections

    private func accept(_ c: NWConnection) {
        c.start(queue: queue)
        var buf = Data()
        var decided = false
        let legacyTimer = DispatchWorkItem { [weak self] in
            guard let self, !decided else { return }
            decided = true
            if self.cfg.allowLegacy && buf.isEmpty { self.becomeActive(c, hello: Hello(), legacy: true) } else { c.cancel() }
        }
        queue.asyncAfter(deadline: .now() + 1.5, execute: legacyTimer)
        func read() {
            c.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, done, error in
                guard let self, !decided else { return }
                if let data { buf.append(data) }
                if let nl = buf.firstIndex(of: 10) {
                    decided = true
                    legacyTimer.cancel()
                    let line = String(decoding: buf[buf.startIndex..<nl], as: UTF8.self).trimmingCharacters(in: .whitespaces)
                    let rest = buf[(nl + 1)...]
                    self.first(line, rest: Data(rest), c)
                } else if done || error != nil || buf.count > 64 * 1024 {
                    decided = true
                    legacyTimer.cancel()
                    c.cancel()
                } else {
                    read()
                }
            }
        }
        read()
    }

    private func first(_ line: String, rest: Data, _ c: NWConnection) {
        let parts = line.split(separator: " ", maxSplits: 2).map(String.init)
        guard parts.first == "MACTV", parts.count >= 2 else {
            // A v0 receiver that spoke first ("keyframe"): treat as legacy if allowed.
            if cfg.allowLegacy { becomeActive(c, hello: Hello(), legacy: true, pendingInput: Data((line + "\n").utf8) + rest) } else { c.cancel() }
            return
        }
        switch parts[1] {
        case "PING":
            reply(c, "MACTV PONG \(protocolVersion) \(cfg.name.replacingOccurrences(of: "\n", with: " "))")
        case "PAIR":
            let args = parts.count > 2 ? parts[2].split(separator: " ", maxSplits: 1).map(String.init) : []
            let r = pairing.pair(pin: args.first ?? "", name: args.count > 1 ? args[1] : "TV")
            reply(c, r.token.map { "MACTV PAIRED \($0)" } ?? "MACTV DENIED \(r.reason ?? "?")")
        case "HELLO":
            let hello = (parts.count > 2 ? try? JSONDecoder().decode(Hello.self, from: Data(parts[2].utf8)) : nil) ?? Hello()
            let name = pairing.check(hello.token)
            if cfg.requirePairing && name == nil {
                log("refused an unpaired receiver from", c.endpoint)
                sendOnce(c, .bye, jsonData(["error": hello.token == nil ? "pair-first" : "unknown-token"]))
                return
            }
            becomeActive(c, hello: hello, legacy: false, deviceName: name, pendingInput: rest)
        default:
            reply(c, "MACTV DENIED unknown-request")
        }
    }

    private func reply(_ c: NWConnection, _ line: String) {
        c.send(content: Data((line + "\n").utf8), completion: .contentProcessed { _ in c.cancel() })
    }

    private func sendOnce(_ c: NWConnection, _ type: Packet, _ payload: Data) {
        c.send(content: frame(type, 0, payload), completion: .contentProcessed { _ in c.cancel() })
    }

    // MARK: the active receiver

    private func becomeActive(_ c: NWConnection, hello: Hello, legacy: Bool, deviceName: String? = nil, pendingInput: Data = Data()) {
        if let old = active { old.cancel() }
        active = c
        inbox = Data()
        pending = 0
        sentBytes = 0; sentFrames = 0; dropped = 0
        since = Date()
        waitingForKey = true
        client = ["address": "\(c.endpoint)", "device": deviceName ?? hello.device?.name ?? (legacy ? "v0 receiver" : "TV"),
                  "model": hello.device?.model ?? "", "link": hello.link ?? "unknown", "protocol": legacy ? "0" : "1"]
        log("receiver:", client["device"]!, "from", c.endpoint, legacy ? "(protocol 0)" : "")
        c.stateUpdateHandler = { [weak self, weak c] state in
            switch state {
            case .failed, .cancelled:
                self?.queue.async { if let c, self?.active === c { self?.drop(c, "closed") } }
            default: break
            }
        }
        var local: String?
        if case let .hostPort(host, _)? = c.currentPath?.localEndpoint { local = "\(host)".components(separatedBy: "%").first }
        let welcome = onReceiver?(hello, legacy ? "legacy" : "v1", local)
        if !legacy, let welcome { c.send(content: frame(.welcome, 0, jsonData(welcome)), completion: .idempotent) }
        if !pendingInput.isEmpty { take(pendingInput) }
        receive(c)
    }

    private func drop(_ c: NWConnection, _ why: String) {
        guard active === c else { return }
        log("receiver gone:", why)
        c.cancel()
        active = nil
        client = [:]
        onGone?()
    }

    private func receive(_ c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, done, error in
            guard let self, self.active === c else { return }
            if let data { self.take(data) }
            if done || error != nil { self.drop(c, error.map { "\($0)" } ?? "closed by the TV"); return }
            self.receive(c)
        }
    }

    private func take(_ data: Data) {
        inbox.append(data)
        while let nl = inbox.firstIndex(of: 10) {
            let line = String(decoding: inbox[inbox.startIndex..<nl], as: UTF8.self)
            inbox.removeSubrange(inbox.startIndex...nl)
            if !line.isEmpty { onLine?(line) }
        }
    }

    var hasReceiver: Bool { flagLock.lock(); defer { flagLock.unlock() }; return activeFlag }

    /// Queues a packet for the receiver. Video other than key frames is dropped while more than `budget` bytes
    /// are waiting (the network is behind): the picture then resumes cleanly at the next key frame.
    func send(_ type: Packet, pts: UInt64, payload: Data, budget: Int) {
        queue.async {
            guard let c = self.active else { return }
            if type == .video || type == .keyVideo || type == .config {
                if type == .video && (self.waitingForKey || self.pending > budget) {
                    self.waitingForKey = true
                    self.dropped += 1
                    return
                }
                if type == .config { self.waitingForKey = false }
            }
            let packet = frame(type, pts, payload)
            self.pending += packet.count
            if type == .video || type == .keyVideo { self.sentFrames += 1 }
            let size = packet.count
            c.send(content: packet, completion: .contentProcessed { [weak self] error in
                self?.queue.async {
                    guard let self else { return }
                    self.pending -= size
                    self.sentBytes += size
                    // The first failed send drops the receiver; the packets queued behind it fail silently.
                    if let error, self.active === c { self.drop(c, "\(error)") }
                }
            })
        }
    }

    /// Bytes waiting to go out, read from any thread.
    var backlog: Int { queue.sync { pending } }

    func stats() -> [String: Any] {
        queue.sync {
            let secs = max(1, Date().timeIntervalSince(since))
            return ["connected": active != nil, "client": client, "pendingBytes": pending, "framesSent": sentFrames,
                    "framesDropped": dropped, "mbpsAverage": Double(Int(Double(sentBytes) * 8 / secs / 1e4)) / 100,
                    "seconds": Int(secs)]
        }
    }
}

func frame(_ type: Packet, _ pts: UInt64, _ payload: Data) -> Data {
    var d = Data(capacity: 13 + payload.count)
    d.append(type.rawValue)
    withUnsafeBytes(of: pts.bigEndian) { d.append(contentsOf: $0) }
    withUnsafeBytes(of: UInt32(payload.count).bigEndian) { d.append(contentsOf: $0) }
    d.append(payload)
    return d
}
