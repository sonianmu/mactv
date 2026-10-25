import AudioToolbox
import CoreAudio
import Foundation

/// Sound for the TV: s16le, 48 kHz, stereo, in packets of whatever the source delivers.
protocol SoundSource: AnyObject {
    var onSound: ((Data) -> Void)? { get set }
    func start()
    func status() -> [String: Any]
}

/// The sound of this user's processes (the session's), taken with a CoreAudio process tap that also mutes
/// them on the Mac's own speakers. Only this session is tapped; the owner's sound is never touched.
///
/// Rules learned the hard way (docs/capture-and-audio.md):
///  - tap only processes that are actually putting sound out (kAudioProcessPropertyIsRunningOutput): mixing in
///    processes without audio produced full-scale noise;
///  - never tear the tap down just because playback paused: with muteBehavior .muted, destroying and
///    rebuilding taps left the browser's audio muted for good; keep the tap, rebuild only for a different
///    non-empty set of processes;
///  - a tap can go silent while its processes still play (the browser restarted its audio service): rebuild
///    only after sound was heard and then 10 s of silence;
///  - PCM on the wire is little-endian; judge noise vs music by mean |difference| (noise ~21000), not by peak.
final class SessionAudio: SoundSource {
    var onSound: ((Data) -> Void)?
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private let lock = NSLock()
    private var current: [AudioObjectID] = []
    private var lastSound = Date()
    private var heardSound = false
    private var channels = 2
    private var interleaved = true
    private var rebuilds = 0
    private let queue = DispatchQueue(label: "audio")
    private var timer: DispatchSourceTimer?

    func start() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now(), repeating: 0.5)
        t.setEventHandler { [weak self] in self?.refresh() }
        t.resume()
        timer = t
        // Rebuild at once when a process opens audio, so a new app is muted here before it is heard.
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &addr, queue) { [weak self] _, _ in self?.refresh() }
    }

    private func prop<T>(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ value: inout T) -> OSStatus {
        var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(MemoryLayout<T>.size)
        return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &value)
    }

    /// This user's processes that are putting sound out right now.
    private func playingProcesses() -> [AudioObjectID] {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size)
        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids)
        let me = getuid(), myself = getpid()
        return ids.filter { obj in
            var pid: pid_t = -1
            guard prop(obj, kAudioProcessPropertyPID, &pid) == noErr, pid != myself else { return false }
            var info = kinfo_proc()
            var len = MemoryLayout<kinfo_proc>.stride
            var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
            guard sysctl(&mib, 4, &info, &len, nil, 0) == 0, len > 0, info.kp_eproc.e_ucred.cr_uid == me else { return false }
            var out: UInt32 = 0
            return prop(obj, kAudioProcessPropertyIsRunningOutput, &out) == noErr && out == 1
        }.sorted()
    }

    private var healthy: Bool { procID != nil && aggID != kAudioObjectUnknown && tapID != kAudioObjectUnknown }

    private func refresh() {
        lock.lock(); defer { lock.unlock() }
        if healthy, heardSound, Date().timeIntervalSince(lastSound) > 10 {
            log("audio tap went silent; rebuilding")
            rebuilds += 1
            stop()
            current = []
            heardSound = false
        }
        let procs = playingProcesses()
        guard !procs.isEmpty else { return }   // paused: keep the tap (see the rules above)
        if procs == current && healthy { return }
        stop()
        current = procs
        let desc = CATapDescription(stereoMixdownOfProcesses: procs)
        desc.muteBehavior = .muted
        desc.isPrivate = true
        var err = AudioHardwareCreateProcessTap(desc, &tapID)
        guard err == noErr else { log("audio tap failed", err); return }
        let agg: [String: Any] = [
            kAudioAggregateDeviceNameKey: "MacTV",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: desc.uuid.uuidString]],
        ]
        err = AudioHardwareCreateAggregateDevice(agg as CFDictionary, &aggID)
        guard err == noErr else { log("audio aggregate failed", err); stop(); current = []; return }
        var asbd = AudioStreamBasicDescription()
        _ = prop(tapID, kAudioTapPropertyFormat, &asbd)
        channels = max(1, Int(asbd.mChannelsPerFrame))
        interleaved = asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
        if asbd.mSampleRate != 48000 { log("audio tap rate", asbd.mSampleRate, "(the TV expects 48000)") }
        err = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { [weak self] _, input, _, _, _ in self?.deliver(input) }
        guard err == noErr, let procID else { log("audio ioproc failed", err); stop(); current = []; return }
        err = AudioDeviceStart(aggID, procID)
        lastSound = Date()
        heardSound = false
        guard err == noErr else { log("audio start failed", err); stop(); current = []; return }
        log("audio tap on", procs.count, "processes,", Int(asbd.mSampleRate), "Hz,", channels, "ch")
    }

    @inline(__always) private func s16(_ v: Float) -> Int16 { Int16(max(-1, min(1, v)) * 32767) }

    /// Float frames to 16-bit stereo, on CoreAudio's IO thread (512-frame buffers: short enough to do here).
    private func deliver(_ input: UnsafePointer<AudioBufferList>) {
        guard let onSound else { return }
        let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
        guard let first = list.first, let d0 = first.mData else { return }
        var peak: Float = 0
        var samples: [Int16]
        if interleaved {
            let n = Int(first.mDataByteSize) / 4, ch = channels
            let f = d0.assumingMemoryBound(to: Float.self)
            samples = [Int16](repeating: 0, count: n / ch * 2)
            var i = 0, j = 0
            while i + ch - 1 < n {
                let l = f[i], r = ch > 1 ? f[i + 1] : f[i]
                peak = max(peak, abs(l), abs(r))
                samples[j] = s16(l); samples[j + 1] = s16(r)
                i += ch; j += 2
            }
        } else {
            let frames = Int(first.mDataByteSize) / 4
            let l = d0.assumingMemoryBound(to: Float.self)
            let r = (list.count > 1 ? list[1].mData : nil)?.assumingMemoryBound(to: Float.self) ?? l
            samples = [Int16](repeating: 0, count: frames * 2)
            for k in 0..<frames {
                peak = max(peak, abs(l[k]), abs(r[k]))
                samples[2 * k] = s16(l[k]); samples[2 * k + 1] = s16(r[k])
            }
        }
        if peak > 0.0005 { lastSound = Date(); heardSound = true }
        onSound(samples.withUnsafeBufferPointer { Data(buffer: $0) })
    }

    private func stop() {
        if let procID { AudioDeviceStop(aggID, procID); AudioDeviceDestroyIOProcID(aggID, procID) }
        if aggID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggID) }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
        procID = nil
        aggID = AudioObjectID(kAudioObjectUnknown)
        tapID = AudioObjectID(kAudioObjectUnknown)
    }

    func status() -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        return ["source": "session", "tapping": healthy, "processes": current.count, "silentRebuilds": rebuilds,
                "secondsSinceSound": heardSound ? Int(Date().timeIntervalSince(lastSound)) : -1]
    }
}

/// A 440 Hz tone in 10 ms packets, for tests (the same path to the TV, no permissions needed).
final class TestTone: SoundSource {
    var onSound: ((Data) -> Void)?
    private var timer: DispatchSourceTimer?
    private var phase = 0.0

    func start() {
        let t = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "tone"))
        t.schedule(deadline: .now(), repeating: 0.01)
        t.setEventHandler { [weak self] in
            guard let self, let onSound = self.onSound else { return }
            var s = [Int16](repeating: 0, count: 480 * 2)
            for k in 0..<480 {
                let v = Int16(sin(self.phase) * 6000)
                s[2 * k] = v; s[2 * k + 1] = v
                self.phase += 2 * .pi * 440 / 48000
            }
            onSound(s.withUnsafeBufferPointer { Data(buffer: $0) })
        }
        t.resume()
        timer = t
    }

    func status() -> [String: Any] { ["source": "test-tone"] }
}
