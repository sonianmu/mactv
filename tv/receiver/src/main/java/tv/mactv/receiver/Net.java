package tv.mactv.receiver;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** The protocol's one-line requests (PING, PAIR), finding the Mac on the local network, and waking it. */
final class Net {
    static final int PORT = 8810;

    private Net() {}

    /** One request line, one answer line; null if nothing answered. */
    static String request(String host, String line, int timeoutMs) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(host, PORT), timeoutMs);
            s.setSoTimeout(timeoutMs + 1000);
            OutputStream o = s.getOutputStream();
            o.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            o.flush();
            return new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8)).readLine();
        } catch (IOException e) {
            return null;
        }
    }

    /** The Mac's name if a MacTV host answers at this address. A PING never disturbs a TV that is watching. */
    static String ping(String host, int timeoutMs) {
        String a = request(host, "MACTV PING", timeoutMs);
        if (a == null || !a.startsWith("MACTV PONG ")) return null;
        String[] p = a.split(" ", 4);
        return p.length > 3 ? p[3] : "Mac";
    }

    /** A pairing token, or "!" + the host's reason ("!wrong-pin", "!no-window"), or null if unreachable. */
    static String pair(String host, String pin, String deviceName) {
        String a = request(host, "MACTV PAIR " + pin + " " + deviceName.replace('\n', ' '), 3000);
        if (a == null) return null;
        String[] p = a.split(" ");
        if (p.length == 3 && p[1].equals("PAIRED")) return p[2];
        return "!" + (p.length > 2 ? p[2] : "refused");
    }

    /**
     * Sweeps the local /24 with PINGs (64 at a time) and returns the first MacTV host. Broadcast discovery
     * isn't used: macOS drops broadcasts from apps without Local Network access, and DHCP moves the Mac.
     */
    static String scan() {
        String own = null;
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) if (a instanceof Inet4Address) own = a.getHostAddress();
            }
        } catch (IOException ignored) {
        }
        if (own == null) return null;
        String prefix = own.substring(0, own.lastIndexOf('.') + 1);
        ExecutorService pool = Executors.newFixedThreadPool(64);
        AtomicReference<String> found = new AtomicReference<>();
        for (int i = 1; i < 255; i++) {
            final String ip = prefix + i;
            if (ip.equals(own)) continue;
            pool.execute(() -> { if (found.get() == null && ping(ip, 400) != null) found.compareAndSet(null, ip); });
        }
        pool.shutdown();
        try { pool.awaitTermination(8, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        pool.shutdownNow();
        return found.get();
    }

    /** Wake-on-LAN to the subnet broadcast (the hardware address came from the Mac's Welcome). */
    static void wake(String mac) {
        if (mac == null) return;
        new Thread(() -> {
            try (DatagramSocket s = new DatagramSocket()) {
                s.setBroadcast(true);
                String[] hex = mac.split(":");
                byte[] hw = new byte[6];
                for (int i = 0; i < 6; i++) hw[i] = (byte) Integer.parseInt(hex[i], 16);
                byte[] packet = new byte[6 + 16 * 6];
                for (int i = 0; i < 6; i++) packet[i] = (byte) 0xFF;
                for (int i = 6; i < packet.length; i += 6) System.arraycopy(hw, 0, packet, i, 6);
                InetAddress b = InetAddress.getByName("255.255.255.255");
                for (int port : new int[] {9, 7}) s.send(new DatagramPacket(packet, packet.length, b, port));
            } catch (Exception ignored) {
            }
        }, "wake").start();
    }
}
