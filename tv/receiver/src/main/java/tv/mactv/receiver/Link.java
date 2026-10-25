package tv.mactv.receiver;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.media.MediaCodec;
import android.media.MediaFormat;
import android.view.Surface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.DataInputStream;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * The connection to the MacTV host (docs/protocol.md): finds the Mac, says HELLO with this TV's capabilities and
 * pairing token, decodes the picture in hardware onto a surface, plays the sound, reports the Mac's status and
 * carries the remote's commands back. Reconnects by itself; tells the screen what is going on.
 */
final class Link {
    interface Listener {
        /**
         * "searching", "connecting" (detail: Mac name), "pair" (no or refused token; detail: reason), "waiting"
         * (connected, no picture yet), "playing", "nodecoder", "lost" (detail: "stalled" | "noscreen" | "nomac").
         */
        void onState(String state, String detail);
        /** The Mac's front app, whether it is a remote-built page (keys, no pointer), and whether it wants text. */
        void onStatus(String app, boolean remote, boolean keyboard);
        /** The pages the Mac offers ("music", "youtube", ...), from its Welcome. */
        void onApps(List<String> apps);
    }

    private static final int RATE = 48000;
    private final Context context;
    private final Store store;
    private final Listener listener;
    private final LinkedBlockingQueue<String> commands = new LinkedBlockingQueue<>();
    private volatile Surface surface;
    private volatile boolean running, picture;
    private volatile Socket socket;
    private volatile long shown;
    private Thread net, writer;
    private final Object pairLock = new Object();

    Link(Context context, Store store, Listener listener) {
        this.context = context;
        this.store = store;
        this.listener = listener;
    }

    void setSurface(Surface s) {
        surface = s;
        if (s == null) close(socket);
    }

    void start() {
        running = true;
        net = new Thread(this::netLoop, "mactv-net");
        net.start();
        writer = new Thread(this::writeLoop, "mactv-commands");
        writer.start();
    }

    void stop() {
        running = false;
        close(socket);
        if (net != null) net.interrupt();
        if (writer != null) writer.interrupt();
        synchronized (pairLock) { pairLock.notifyAll(); }
    }

    /** A token arrived (pairing done): stop waiting and connect. */
    void paired() { synchronized (pairLock) { pairLock.notifyAll(); } }

    /** Queues one command line for the Mac (docs/protocol.md). Dropped while not connected. */
    void send(String line) { if (socket != null) commands.offer(line); }

    private void writeLoop() {
        try {
            while (running) {
                String line = commands.take();
                Socket s = socket;
                if (s == null) continue;
                try {
                    OutputStream o = s.getOutputStream();
                    o.write((line + "\n").getBytes(StandardCharsets.UTF_8));
                    o.flush();
                } catch (IOException ignored) {
                }
            }
        } catch (InterruptedException ignored) {
        }
    }

    // MARK: finding the Mac

    /** Manual address, then the last one that answered, then a sweep of the subnet. */
    private String findMac() {
        for (String h : new String[] {store.manualHost(), store.host()}) {
            if (h == null) continue;
            String name = Net.ping(h, 1500);
            if (name != null) { store.setMacName(name); return h; }
        }
        listener.onState("searching", null);
        String h = Net.scan();
        if (h != null) store.setHost(h);
        return h;
    }

    /** Which link broke, from what still answers, so the screen can say something useful. */
    private String why(Exception e, String host) {
        if (e instanceof SocketTimeoutException && picture) return "stalled";
        return host != null && Net.ping(host, 1200) != null ? "noscreen" : "nomac";
    }

    // MARK: the stream

    private static final class Packet {
        final int type;
        final long pts;
        final byte[] data;
        Packet(int type, long pts, byte[] data) { this.type = type; this.pts = pts; this.data = data; }
    }

    /**
     * Three threads per connection, so none waits on another: this one reads the socket; a feeder hands video
     * to the decoder (blocking there is fine); a player writes sound to the AudioTrack. A decoder briefly full
     * must never hold up the sound (crackle) or make a frame be thrown away (smearing until the next key frame).
     */
    private void netLoop() {
        while (running) {
            MediaCodec codec = null;
            AudioTrack audio = null;
            Thread drain = null, feeder = null, player = null;
            final LinkedBlockingDeque<Packet> video = new LinkedBlockingDeque<>();
            final LinkedBlockingDeque<byte[]> sound = new LinkedBlockingDeque<>();
            String host = null;
            try {
                while (running && surface == null) Thread.sleep(50);
                host = findMac();
                if (host == null) { Thread.sleep(3000); continue; }
                if (store.token() == null) {
                    listener.onState("pair", null);
                    synchronized (pairLock) { while (running && store.token() == null) pairLock.wait(); }
                    continue;
                }
                listener.onState("connecting", store.macName());
                Socket s = new Socket();
                s.connect(new InetSocketAddress(host, Net.PORT), 3000);
                s.setTcpNoDelay(true);
                // The host sends at least a frame every 0.1 s, so 3 s of silence means the Mac is gone (a sleeping
                // Mac sends no FIN, and a read would otherwise wait forever).
                s.setSoTimeout(3000);
                s.setReceiveBufferSize(4 << 20);
                OutputStream o = s.getOutputStream();
                o.write(("MACTV HELLO " + Caps.hello(context, store.token()) + "\n").getBytes(StandardCharsets.UTF_8));
                o.flush();
                DataInputStream in = new DataInputStream(new java.io.BufferedInputStream(s.getInputStream(), 1 << 16));
                // The first packet is the answer: Welcome, or Bye with the reason.
                int t0 = in.readUnsignedByte();
                in.readLong();
                byte[] first = new byte[in.readInt()];
                in.readFully(first);
                JSONObject answer = new JSONObject(new String(first, StandardCharsets.UTF_8));
                if (t0 == 7) {
                    String err = answer.optString("error");
                    dbg("refused: " + err);
                    if (err.equals("pair-first") || err.equals("unknown-token")) store.setToken(null);
                    listener.onState("pair", err);
                    close(s);
                    continue;
                }
                JSONObject v = answer.getJSONObject("video");
                store.setWake(answer.optString("wake", null));
                store.setMacName(answer.optString("host", store.macName()));
                List<String> apps = new ArrayList<>();
                JSONArray a = answer.optJSONArray("apps");
                for (int i = 0; a != null && i < a.length(); i++) apps.add(a.getString(i));
                JSONObject t = answer.optJSONObject("titles");
                if (t != null) for (java.util.Iterator<String> k = t.keys(); k.hasNext(); ) { String n = k.next(); MenuBar.titles.put(n, t.optString(n, n)); }
                listener.onApps(apps);
                dbg("welcome " + v);
                socket = s;
                picture = false;
                listener.onState("waiting", null);
                final AudioTrack track = audio = newAudioTrack();
                player = new Thread(() -> playLoop(track, sound), "mactv-audio");
                player.start();
                byte[] config = null;
                while (running) {
                    int type = in.readUnsignedByte();
                    long pts = in.readLong();
                    byte[] data = new byte[in.readInt()];
                    in.readFully(data);
                    if (type == 4) {
                        if (codec == null || !Arrays.equals(config, data)) {
                            if (feeder != null) { feeder.interrupt(); feeder.join(500); }
                            if (drain != null) drain.interrupt();
                            if (codec != null) { codec.stop(); codec.release(); }
                            config = data;
                            video.clear();
                            codec = newDecoder(data, v);
                            final MediaCodec c = codec;
                            final byte[] cfg = config;
                            drain = new Thread(() -> drainLoop(c), "mactv-drain");
                            drain.start();
                            feeder = new Thread(() -> feedLoop(c, cfg, video), "mactv-feed");
                            feeder.start();
                        }
                    } else if (type == 1 || type == 3) {
                        if (codec != null) video.offer(new Packet(type, pts, data));
                    } else if (type == 2) {
                        sound.offer(data);
                    } else if (type == 5) {
                        JSONObject st = new JSONObject(new String(data, StandardCharsets.UTF_8));
                        listener.onStatus(st.optString("app", "other"), st.optBoolean("remote", false), st.optBoolean("keyboard", false));
                    } else if (type == 7) {
                        throw new IOException("host said bye: " + new String(data, StandardCharsets.UTF_8));
                    }
                }
            } catch (InterruptedException e) {
                break;
            } catch (Exception e) {
                dbg("stream ended: " + e);
                if (running) listener.onState("lost", why(e, host));
            } finally {
                close(socket);
                socket = null;
                commands.clear();
                if (feeder != null) feeder.interrupt();
                if (player != null) player.interrupt();
                if (drain != null) drain.interrupt();
                if (feeder != null) try { feeder.join(500); } catch (InterruptedException ignored) { }
                if (codec != null) {
                    try { codec.stop(); } catch (Exception ignored) { }
                    codec.release();
                }
                if (player != null) try { player.join(500); } catch (InterruptedException ignored) { }
                if (audio != null) { audio.stop(); audio.release(); }
            }
            try { Thread.sleep(1500); } catch (InterruptedException e) { break; }
        }
    }

    /**
     * Hands frames to the decoder in order, waiting when it is busy. Frames are dropped only when the picture has
     * fallen more than half a second behind, and then all the way to a fresh key frame (asked of the Mac) so
     * nothing is decoded against a missing reference.
     */
    private void feedLoop(MediaCodec codec, byte[] config, LinkedBlockingDeque<Packet> video) {
        boolean waitKey = false;
        long fed = 0, skipped = 0, since = System.currentTimeMillis(), stuckSince = 0;
        try {
            while (running && !Thread.currentThread().isInterrupted()) {
                Packet p = video.take();
                if (video.size() > 30) {
                    skipped += video.size() + 1;
                    video.clear();
                    waitKey = true;
                    send("keyframe");
                    continue;
                }
                if (waitKey) {
                    if (p.type != 3) { skipped++; continue; }
                    waitKey = false;
                }
                int idx;
                while ((idx = codec.dequeueInputBuffer(100_000)) < 0) {
                    if (stuckSince == 0) stuckSince = System.currentTimeMillis();
                    else if (System.currentTimeMillis() - stuckSince > 3000) {
                        // The decoder has taken nothing for 3 s: the TV's own middleware is holding the only
                        // hardware decoder (docs/tv-notes.md).
                        dbg("decoder takes no input");
                        listener.onState("nodecoder", null);
                        stuckSince = System.currentTimeMillis();
                    }
                    if (!running || Thread.currentThread().isInterrupted()) return;
                }
                stuckSince = 0;
                ByteBuffer b = codec.getInputBuffer(idx);
                b.clear();
                int extra = p.type == 3 ? config.length : 0;
                if (b.capacity() < p.data.length + extra) {
                    codec.queueInputBuffer(idx, 0, 0, p.pts, 0);
                    dbg("frame too big " + p.data.length);
                    waitKey = true;
                    send("keyframe");
                    continue;
                }
                // The parameter sets ride in front of every key frame too: some TV decoders ignore csd.
                if (p.type == 3) b.put(config);
                b.put(p.data);
                codec.queueInputBuffer(idx, 0, b.position(), p.pts, p.type == 3 ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0);
                fed++;
                long now = System.currentTimeMillis();
                if (now - since >= 10_000) {
                    dbg("video fed " + fed + " skipped " + skipped + " shown " + shown + " in " + (now - since) + " ms");
                    fed = 0; skipped = 0; shown = 0; since = now;
                }
            }
        } catch (InterruptedException | IllegalStateException e) {
            // connection closing or decoder replaced
        }
    }

    /**
     * Writes sound as it comes. If more than a quarter second piles up (the Mac's clock outran the TV's, or a
     * hiccup), the oldest goes, so picture and sound stay together.
     */
    private void playLoop(AudioTrack track, LinkedBlockingDeque<byte[]> sound) {
        try {
            while (running && !Thread.currentThread().isInterrupted()) {
                byte[] d = sound.take();
                int queued = 0;
                for (byte[] q : sound) queued += q.length / 4;
                if (queued > RATE / 4) {
                    while (queued > RATE / 10) {
                        byte[] q = sound.poll();
                        if (q == null) break;
                        queued -= q.length / 4;
                    }
                }
                int off = 0;
                while (off < d.length) {
                    int n = track.write(d, off, d.length - off, AudioTrack.WRITE_BLOCKING);
                    if (n <= 0) break;
                    off += n;
                }
            }
        } catch (InterruptedException | IllegalStateException e) {
            // connection closing
        }
    }

    /** The decoder for the Welcome's codec and size; the parameter sets go in as codec-specific data too. */
    private MediaCodec newDecoder(byte[] config, JSONObject v) throws IOException {
        boolean hevc = "hevc".equals(v.optString("codec")) || config.length > 4 && (config[4] & 0x7E) >> 1 == 32;
        String mime = hevc ? MediaFormat.MIMETYPE_VIDEO_HEVC : MediaFormat.MIMETYPE_VIDEO_AVC;
        MediaFormat f = MediaFormat.createVideoFormat(mime, v.optInt("width", 1920), v.optInt("height", 1080));
        if (hevc) {
            f.setByteBuffer("csd-0", ByteBuffer.wrap(config));
        } else {
            int split = 4;
            while (split + 3 < config.length && !(config[split] == 0 && config[split + 1] == 0 && config[split + 2] == 0 && config[split + 3] == 1)) split++;
            f.setByteBuffer("csd-0", ByteBuffer.wrap(config, 0, split));
            f.setByteBuffer("csd-1", ByteBuffer.wrap(config, split, config.length - split));
        }
        // A 4K key frame can run to a few MB.
        f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 8 << 20);
        dbg("decoder " + mime);
        MediaCodec c = MediaCodec.createDecoderByType(mime);
        c.configure(f, surface, null, 0);
        c.start();
        return c;
    }

    /** Shows each decoded picture as soon as it is ready: latency matters more than pacing here. */
    private void drainLoop(MediaCodec c) {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        while (running && !Thread.currentThread().isInterrupted()) {
            try {
                int idx = c.dequeueOutputBuffer(info, 20_000);
                if (idx >= 0) {
                    c.releaseOutputBuffer(idx, true);
                    shown++;
                    if (!picture) { picture = true; listener.onState("playing", null); }
                }
            } catch (IllegalStateException e) {
                return;
            }
        }
    }

    private AudioTrack newAudioTrack() {
        AudioFormat fmt = new AudioFormat.Builder().setSampleRate(RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build();
        int min = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        AudioTrack t = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build())
                .setAudioFormat(fmt).setBufferSizeInBytes(Math.max(min, RATE * 4 * 12 / 100))
                .setTransferMode(AudioTrack.MODE_STREAM).build();
        t.play();
        return t;
    }

    /** Appends to the app's files/mactv-debug.txt: some TVs drop third-party logcat lines. */
    void dbg(String line) {
        try (FileWriter w = new FileWriter(new File(context.getExternalFilesDir(null), "mactv-debug.txt"), true)) {
            w.write(System.currentTimeMillis() % 100000 + " " + line + "\n");
        } catch (IOException | NullPointerException ignored) {
        }
    }

    private static void close(Socket s) {
        if (s == null) return;
        try { s.close(); } catch (IOException ignored) { }
    }
}
