import Foundation

/// Wire protocol v1, the contract with the TV (docs/protocol.md is the full text; keep the two in step).
///
/// A connection to `Config.port` starts with one text line from the client, which decides what it is:
///   MACTV PING                      discovery: answered with "MACTV PONG 1 <name>" and closed; never disturbs
///                                   the TV that is watching
///   MACTV PAIR <pin> <device name>  pairing: answered with "MACTV PAIRED <token>" or "MACTV DENIED <reason>"
///   MACTV HELLO <json>              a receiver: capabilities and token (Hello below); on success the host
///                                   sends packet 6 (Welcome) and starts streaming, replacing any previous TV
/// (no line within 1.5 s)            a protocol-v0 receiver, accepted only with Config.allowLegacy
///
/// After that the host sends packets: u8 type, u64 pts (microseconds), u32 length, payload (big-endian).
/// The client sends newline-terminated commands (Control.swift).
enum Packet: UInt8 {
    case video = 1        // Annex B frame
    case audio = 2        // s16le interleaved, rate and channels from Welcome (48 kHz stereo)
    case keyVideo = 3     // Annex B key frame
    case config = 4       // parameter sets (VPS/SPS/PPS or SPS/PPS), Annex B, before every key frame
    case status = 5       // JSON: {"front":bundle,"app":name,"remote":bool,"keyboard":bool}
    case welcome = 6      // JSON: Welcome
    case bye = 7          // JSON: {"error": reason}; the host closes after it
}

let protocolVersion = 1

/// What the TV says about itself in HELLO. Every field is optional; missing ones mean "assume the least".
struct Hello: Codable {
    var proto: Int?
    var token: String?
    var device: Device?
    var video: VideoCaps?
    /// "ethernet", "wifi" or "unknown".
    var link: String?

    struct Device: Codable { var name: String?; var model: String?; var sdk: Int? }
    struct VideoCaps: Codable {
        /// Decoders available in hardware, best first: "hevc", "avc".
        var codecs: [String]?
        var maxWidth: Int?
        var maxHeight: Int?
    }
}

/// The host's answer: what it will send.
struct Welcome: Codable {
    var proto = protocolVersion
    var host: String
    var video: Video
    var audio = Audio()
    /// The Mac's hardware address on the network the TV reached it on, for Wake-on-LAN later. Sent here so it
    /// is never configured by hand.
    var wake: String?
    /// The pages the TV can open with "app <name>" (besides "desktop"), for its menu.
    var apps: [String] = []
    /// Menu names for those pages, where they differ from the name.
    var titles: [String: String] = [:]

    struct Video: Codable { var codec: String; var width: Int; var height: Int; var fps: Int; var bitrate: Int }
    struct Audio: Codable { var rate = 48000; var channels = 2 }
}

/// Picks codec, size and bitrate from the TV's capabilities, its link and the config. Pure, so it is tested
/// directly (tests/test_protocol.py checks the outcome over the wire).
func negotiate(_ hello: Hello, _ cfg: Config, sourceWidth: Int, sourceHeight: Int) -> Welcome.Video {
    let codecs = hello.video?.codecs ?? ["avc"]
    let codec = codecs.contains("hevc") ? "hevc" : "avc"
    let wifi = hello.link == "wifi"
    // H.264 decoders on TVs commonly stop at 1080p; HEVC is what makes 4K practical.
    var maxW = min(cfg.maxWidth, hello.video?.maxWidth ?? 1920)
    var maxH = min(cfg.maxHeight, hello.video?.maxHeight ?? 1080)
    if codec == "avc" { maxW = min(maxW, 1920); maxH = min(maxH, 1080) }
    if wifi && cfg.wifiMax1080 { maxW = min(maxW, 1920); maxH = min(maxH, 1080) }
    // Keep the source's shape, scaled to fit, in even numbers.
    let scale = min(Double(maxW) / Double(sourceWidth), Double(maxH) / Double(sourceHeight))
    let w = Int(Double(sourceWidth) * scale) & ~1, h = Int(Double(sourceHeight) * scale) & ~1
    let bitrate = wifi ? cfg.bitrateWifi : (w * h > 1920 * 1080 ? cfg.bitrate4KWired : cfg.bitrate1080Wired)
    return Welcome.Video(codec: codec, width: w, height: h, fps: cfg.fps, bitrate: bitrate)
}

/// The v0 receiver's fixed expectation: 4K HEVC.
func legacyVideo(_ cfg: Config) -> Welcome.Video {
    Welcome.Video(codec: "hevc", width: min(cfg.maxWidth, 3840), height: min(cfg.maxHeight, 2160), fps: cfg.fps, bitrate: cfg.bitrate4KWired)
}

func jsonData<T: Encodable>(_ v: T) -> Data { (try? JSONEncoder().encode(v)) ?? Data("{}".utf8) }
