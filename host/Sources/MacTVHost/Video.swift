import CoreMedia
import CoreVideo
import Foundation
import QuartzCore
import ScreenCaptureKit
import VideoToolbox

let startTime = CACurrentMediaTime()
func nowMicros() -> UInt64 { UInt64((CACurrentMediaTime() - startTime) * 1_000_000) }

/// Where pictures come from: the session's display (ScreenSource) or a generated test pattern (TestSource,
/// for tests on any Mac without permissions). Pictures are NV12 at the size asked for.
protocol PictureSource: AnyObject {
    var onPicture: ((CVPixelBuffer) -> Void)? { get set }
    /// The source's natural size in pixels, for choosing the stream's shape.
    var naturalSize: (Int, Int) { get }
    func start(width: Int, height: Int, fps: Int) async throws
    func resize(width: Int, height: Int, fps: Int)
    func status() -> [String: Any]
}

// MARK: - the session's display

final class ScreenSource: NSObject, PictureSource, SCStreamOutput, SCStreamDelegate {
    var onPicture: ((CVPixelBuffer) -> Void)?
    /// Called after the display was replaced and capture restarted (windows may have dropped out of full screen).
    var onRestart: (() -> Void)?
    private(set) var naturalSize = (3840, 2160)
    private var stream: SCStream?
    private var display: SCDisplay?
    private var hiddenApps: Set<String>
    /// Off only while checking that hiding works (`mactv filter off`).
    var hiding = true
    private var hiddenPIDs: [pid_t] = []
    private var size = (3840, 2160, 60)

    init(hiddenApps: [String]) {
        self.hiddenApps = Set(hiddenApps)
    }

    func start(width: Int, height: Int, fps: Int) async throws {
        size = (width, height, fps)
        let content = try await SCShareableContent.current
        guard let display = content.displays.first else {
            throw NSError(domain: "mactv", code: 1, userInfo: [NSLocalizedDescriptionKey: "no display in this session; is the holder connected?"])
        }
        self.display = display
        // Points to pixels: the session's framebuffer is drawn at twice its point size.
        naturalSize = (display.width * 2, display.height * 2)
        let (filter, pids) = makeFilter(content, display)
        hiddenPIDs = pids
        let s = SCStream(filter: filter, configuration: configuration(), delegate: self)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "capture"))
        try await s.startCapture()
        stream = s
        log("capturing display", display.displayID, "\(display.width)x\(display.height) pt at \(width)x\(height),",
            "hiding", hiddenApps.sorted().joined(separator: ","), "pids", pids)
    }

    private func configuration() -> SCStreamConfiguration {
        let cfg = SCStreamConfiguration()
        cfg.width = size.0
        cfg.height = size.1
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(size.2))
        cfg.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        cfg.colorMatrix = CGDisplayStream.yCbCrMatrix_ITU_R_709_2
        cfg.colorSpaceName = CGColorSpace.itur_709
        cfg.queueDepth = 5
        // The session's cursor is not where the TV's pointer is; the TV draws its own.
        cfg.showsCursor = false
        return cfg
    }

    private func makeFilter(_ content: SCShareableContent, _ display: SCDisplay) -> (SCContentFilter, [pid_t]) {
        let hidden = hiding ? content.applications.filter { hiddenApps.contains($0.bundleIdentifier) } : []
        return (SCContentFilter(display: display, excludingApplications: hidden, exceptingWindows: []), hidden.map(\.processID).sorted())
    }

    func resize(width: Int, height: Int, fps: Int) {
        guard (width, height, fps) != size else { return }
        size = (width, height, fps)
        stream?.updateConfiguration(configuration()) { e in if let e { log("capture resize failed:", e.localizedDescription) } }
    }

    /// Hidden apps are matched by process; when one restarts (or hiding is toggled) the filter is renewed.
    func refreshFilter(force: Bool = false) {
        Task {
            guard let s = stream, let display, let content = try? await SCShareableContent.current else { return }
            let (filter, pids) = makeFilter(content, display)
            guard force || pids != hiddenPIDs else { return }
            try? await s.updateContentFilter(filter)
            hiddenPIDs = pids
            log("capture filter:", hiding ? "hiding" : "showing", hiddenApps.sorted().joined(separator: ","), "pids", pids)
        }
    }

    func stream(_ s: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, let pixels = CMSampleBufferGetImageBuffer(sb) else { return }
        onPicture?(pixels)
    }

    func stream(_ s: SCStream, didStopWithError error: Error) {
        log("capture stopped:", error.localizedDescription)
        stream = nil
        restart()
    }

    /// The session's display is replaced now and then (Screen Sharing reconfigures it, a fast user switch
    /// into the session and back): pick up the new one instead of going dark.
    private func restart() {
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            do {
                try await start(width: size.0, height: size.1, fps: size.2)
                onRestart?()
            } catch {
                log("capture restart failed:", error.localizedDescription)
                restart()
            }
        }
    }

    func status() -> [String: Any] {
        ["source": "screen", "capturing": stream != nil, "hiding": hiding, "hiddenPids": hiddenPIDs, "size": [size.0, size.1, size.2]]
    }
}

// MARK: - test pattern

/// Moving colour bars and a clock-like sweep, generated in NV12: lets the whole pipeline (encoder, protocol,
/// receiver) be tested on any Mac, in any session, without Screen Recording.
final class TestSource: PictureSource {
    var onPicture: ((CVPixelBuffer) -> Void)?
    let naturalSize = (3840, 2160)
    private var timer: DispatchSourceTimer?
    private var size = (1920, 1080, 30)
    private var pool: CVPixelBufferPool?
    private var n = 0
    private let queue = DispatchQueue(label: "testsource")

    func start(width: Int, height: Int, fps: Int) async throws {
        resize(width: width, height: height, fps: fps)
        log("test pattern at \(width)x\(height) \(fps) fps")
    }

    func resize(width: Int, height: Int, fps: Int) {
        queue.sync {
            size = (width, height, fps)
            let attrs: [CFString: Any] = [kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
                                          kCVPixelBufferWidthKey: width, kCVPixelBufferHeightKey: height,
                                          kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary]
            CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &pool)
            timer?.cancel()
            let t = DispatchSource.makeTimerSource(queue: queue)
            t.schedule(deadline: .now(), repeating: 1.0 / Double(fps))
            t.setEventHandler { [weak self] in self?.tick() }
            t.resume()
            timer = t
        }
    }

    private func tick() {
        guard let pool else { return }
        var pb: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
        guard let pb else { return }
        CVPixelBufferLockBaseAddress(pb, [])
        let w = size.0, h = size.1
        let y = CVPixelBufferGetBaseAddressOfPlane(pb, 0)!.assumingMemoryBound(to: UInt8.self)
        let yStride = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
        let uv = CVPixelBufferGetBaseAddressOfPlane(pb, 1)!.assumingMemoryBound(to: UInt8.self)
        let uvStride = CVPixelBufferGetBytesPerRowOfPlane(pb, 1)
        let shift = (n * 8) % w, bar = max(1, w / 8)
        for row in 0..<h {
            let line = y + row * yStride
            for col in 0..<w { line[col] = UInt8(16 + (((col + shift) / bar) % 8) * 28) }
        }
        // A bright band that sweeps down, so motion is visible in a screenshot sequence.
        let band = (n * 6) % h
        for row in band..<min(h, band + 8) { memset(y + row * yStride, 235, w) }
        for row in 0..<(h / 2) {
            let line = uv + row * uvStride
            for col in stride(from: 0, to: w, by: 2) {
                let k = ((col + shift) / bar) % 8
                line[col] = UInt8(128 + (k - 4) * 12)
                line[col + 1] = UInt8(128 + (4 - k) * 10)
            }
        }
        CVPixelBufferUnlockBaseAddress(pb, [])
        n += 1
        onPicture?(pb)
    }

    func status() -> [String: Any] { ["source": "test", "size": [size.0, size.1, size.2]] }
}

// MARK: - encoder

/// VideoToolbox encoder, rebuilt whenever the negotiated codec or size changes. Emits Annex B: parameter sets
/// (packet 4) before every key frame, then the frame (3), or a plain frame (1).
final class VideoEncoder {
    var emit: ((Packet, UInt64, Data) -> Void)?
    private var session: VTCompressionSession?
    private let lock = NSLock()
    private var forceKey = true
    private var lastBuffer: CVPixelBuffer?
    private var lastEncode = CACurrentMediaTime()
    private(set) var video = Welcome.Video(codec: "hevc", width: 3840, height: 2160, fps: 60, bitrate: 40_000_000)
    private(set) var bitrate = 40_000_000
    private var encoded = 0
    /// Bumped by every configure. Frames still in flight from an older session are dropped, or a new receiver
    /// could get one packet in the previous codec (HEVC parameter sets on a TV that asked for H.264).
    /// Its own lock: invalidating a session (under `lock`) waits for in-flight callbacks, which read this.
    private var generation = 0
    private let genLock = NSLock()

    func configure(_ v: Welcome.Video) {
        lock.lock(); defer { lock.unlock() }
        genLock.lock(); generation += 1; genLock.unlock()
        if let s = session { VTCompressionSessionInvalidate(s); session = nil }
        video = v
        bitrate = v.bitrate
        let hevc = v.codec == "hevc"
        let spec = [kVTVideoEncoderSpecification_EnableLowLatencyRateControl: true] as CFDictionary
        let err = VTCompressionSessionCreate(allocator: nil, width: Int32(v.width), height: Int32(v.height),
                                             codecType: hevc ? kCMVideoCodecType_HEVC : kCMVideoCodecType_H264,
                                             encoderSpecification: spec, imageBufferAttributes: nil,
                                             compressedDataAllocator: nil, outputCallback: nil, refcon: nil,
                                             compressionSessionOut: &session)
        guard err == noErr, let session else { log("encoder create failed", err); return }
        let props: [CFString: Any] = [
            kVTCompressionPropertyKey_RealTime: true,
            kVTCompressionPropertyKey_ProfileLevel: hevc ? kVTProfileLevel_HEVC_Main_AutoLevel : kVTProfileLevel_H264_High_AutoLevel,
            // No B-frames: every frame can be shown as soon as it is decoded.
            kVTCompressionPropertyKey_AllowFrameReordering: false,
            kVTCompressionPropertyKey_ExpectedFrameRate: v.fps,
            // Say BT.709 in the stream: untagged HEVC was read as BT.2020 by a TV and came out warm and dull.
            kVTCompressionPropertyKey_ColorPrimaries: kCVImageBufferColorPrimaries_ITU_R_709_2,
            kVTCompressionPropertyKey_TransferFunction: kCVImageBufferTransferFunction_ITU_R_709_2,
            kVTCompressionPropertyKey_YCbCrMatrix: kCVImageBufferYCbCrMatrix_ITU_R_709_2,
            kVTCompressionPropertyKey_MaxKeyFrameInterval: v.fps * 2,
        ]
        for (k, val) in props { VTSessionSetProperty(session, key: k, value: val as CFTypeRef) }
        applyBitrate(session, bitrate)
        VTCompressionSessionPrepareToEncodeFrames(session)
        forceKey = true
        log("encoder:", v.codec, "\(v.width)x\(v.height)", v.fps, "fps,", v.bitrate / 1_000_000, "Mbps")
    }

    private func applyBitrate(_ s: VTCompressionSession, _ b: Int) {
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AverageBitRate, value: b as CFTypeRef)
        // Bursts (a full-screen change) capped at about 2x the average over one second.
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_DataRateLimits, value: [b / 8 * 2, 1] as CFArray)
    }

    /// Changes the bitrate of the running session (the adaptive controller).
    func setBitrate(_ b: Int) {
        lock.lock(); defer { lock.unlock() }
        guard let session, b != bitrate else { return }
        bitrate = b
        applyBitrate(session, b)
    }

    func keep(_ pixels: CVPixelBuffer) { lock.lock(); lastBuffer = pixels; lock.unlock() }

    /// A key frame now. The screen may be still (nothing new arrives then), so the last picture is re-encoded.
    func requestKeyFrame() {
        lock.lock(); forceKey = true; let b = lastBuffer; lock.unlock()
        if let b { encode(b) }
    }

    /// Nothing arrives while the screen is still, but TV decoders hold pictures back until more frames come:
    /// re-encoding the last picture every ~0.1 s keeps it flowing for a few bytes a frame.
    func repeatIfIdle() {
        lock.lock(); let idle = CACurrentMediaTime() - lastEncode > 0.09; let b = lastBuffer; lock.unlock()
        if idle, let b { encode(b) }
    }

    func encode(_ pixels: CVPixelBuffer) {
        lock.lock()
        guard let session else { lock.unlock(); return }
        lastEncode = CACurrentMediaTime()
        lastBuffer = pixels
        let key = forceKey
        forceKey = false
        genLock.lock(); let gen = generation; genLock.unlock()
        let hevc = video.codec == "hevc"
        lock.unlock()
        let opts = key ? [kVTEncodeFrameOptionKey_ForceKeyFrame: true] as CFDictionary : nil
        let pts = CMTime(value: CMTimeValue(nowMicros()), timescale: 1_000_000)
        VTCompressionSessionEncodeFrame(session, imageBuffer: pixels, presentationTimeStamp: pts, duration: .invalid,
                                        frameProperties: opts, infoFlagsOut: nil) { [weak self] status, _, sample in
            guard status == noErr, let sample, let self else { return }
            self.genLock.lock(); let current = gen == self.generation; self.genLock.unlock()
            guard current else { return }
            self.encoded += 1
            VideoEncoder.annexB(sample, hevc: hevc) { self.emit?($0, $1, $2) }
        }
    }

    private static let startCode: [UInt8] = [0, 0, 0, 1]

    static func annexB(_ sample: CMSampleBuffer, hevc: Bool, out: (Packet, UInt64, Data) -> Void) {
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
        let isKey = !(attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false)
        let pts = UInt64(max(0, CMSampleBufferGetPresentationTimeStamp(sample).seconds * 1_000_000))
        if isKey, let desc = CMSampleBufferGetFormatDescription(sample) {
            var config = Data()
            var count = 0
            let get: (Int, UnsafeMutablePointer<UnsafePointer<UInt8>?>?, UnsafeMutablePointer<Int>?, UnsafeMutablePointer<Int>?) -> OSStatus = { i, p, s, c in
                hevc ? CMVideoFormatDescriptionGetHEVCParameterSetAtIndex(desc, parameterSetIndex: i, parameterSetPointerOut: p, parameterSetSizeOut: s, parameterSetCountOut: c, nalUnitHeaderLengthOut: nil)
                     : CMVideoFormatDescriptionGetH264ParameterSetAtIndex(desc, parameterSetIndex: i, parameterSetPointerOut: p, parameterSetSizeOut: s, parameterSetCountOut: c, nalUnitHeaderLengthOut: nil)
            }
            _ = get(0, nil, nil, &count)
            for i in 0..<count {
                var ptr: UnsafePointer<UInt8>?
                var size = 0
                _ = get(i, &ptr, &size, nil)
                if let ptr { config.append(contentsOf: startCode); config.append(ptr, count: size) }
            }
            out(.config, pts, config)
        }
        guard let block = CMSampleBufferGetDataBuffer(sample) else { return }
        var length = 0
        var base: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &base)
        guard let base else { return }
        // AVCC (4-byte big-endian lengths) to Annex B.
        var data = Data(capacity: length + 64)
        base.withMemoryRebound(to: UInt8.self, capacity: length) { p in
            var i = 0
            while i + 4 <= length {
                let n = Int(p[i]) << 24 | Int(p[i + 1]) << 16 | Int(p[i + 2]) << 8 | Int(p[i + 3])
                i += 4
                guard i + n <= length else { break }
                data.append(contentsOf: startCode)
                data.append(p + i, count: n)
                i += n
            }
        }
        out(isKey ? .keyVideo : .video, pts, data)
    }

    func status() -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        return ["codec": video.codec, "width": video.width, "height": video.height, "fps": video.fps,
                "targetBitrate": video.bitrate, "bitrate": bitrate, "framesEncoded": encoded]
    }
}

// MARK: - bitrate control

/// Lowers the bitrate when the network falls behind (bytes pile up waiting to be sent) and raises it back
/// slowly once it keeps up. Checked twice a second.
final class BitrateController {
    private let encoder: VideoEncoder
    private let minimum: Int
    private var calm = 0

    init(encoder: VideoEncoder, minimum: Int) {
        self.encoder = encoder
        self.minimum = minimum
    }

    func check(backlog: Int) {
        let target = encoder.video.bitrate, now = encoder.bitrate
        // More than a quarter second of video waiting: the link can't carry this rate.
        if backlog > now / 8 / 4 {
            calm = 0
            let next = max(minimum, now * 3 / 4)
            if next < now { encoder.setBitrate(next); log("bitrate down to", next / 1_000_000, "Mbps (backlog \(backlog / 1024) KB)") }
        } else if now < target {
            calm += 1
            // Twenty calm checks (10 s) before each step up.
            if calm >= 20 {
                calm = 0
                let next = min(target, now * 11 / 10 + 500_000)
                encoder.setBitrate(next)
                log("bitrate up to", next / 1_000_000, "Mbps")
            }
        }
    }
}
