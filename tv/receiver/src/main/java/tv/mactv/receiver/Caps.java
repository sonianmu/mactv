package tv.mactv.receiver;

import android.content.Context;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What this TV tells the Mac in HELLO (docs/protocol.md): hardware decoders, the largest picture they take,
 * and whether the network is wired. The Mac picks codec, size and bitrate from this.
 */
final class Caps {
    private Caps() {}

    static JSONObject hello(Context c, String token) throws Exception {
        JSONObject video = new JSONObject();
        JSONArray codecs = new JSONArray();
        int[] hevc = largest(MediaCodecInfoMime.HEVC), avc = largest(MediaCodecInfoMime.AVC);
        if (hevc != null) codecs.put("hevc");
        if (avc != null) codecs.put("avc");
        int[] best = hevc != null ? hevc : avc != null ? avc : new int[] {1920, 1080};
        video.put("codecs", codecs).put("maxWidth", best[0]).put("maxHeight", best[1]);
        JSONObject device = new JSONObject().put("name", deviceName(c)).put("model", Build.MANUFACTURER + " " + Build.MODEL)
                .put("sdk", Build.VERSION.SDK_INT);
        JSONObject h = new JSONObject().put("proto", 1).put("device", device).put("video", video).put("link", link(c));
        if (token != null) h.put("token", token);
        return h;
    }

    static final class MediaCodecInfoMime {
        static final String HEVC = "video/hevc", AVC = "video/avc";
    }

    /**
     * The largest 16:9 size a hardware decoder for this type takes ({3840, 2160} or {1920, 1080}), or null if
     * there is none. Software decoders ("OMX.google.", "c2.android.") don't count: they can't keep up.
     */
    static int[] largest(String mime) {
        int[] best = null;
        for (MediaCodecInfo info : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
            if (info.isEncoder()) continue;
            String n = info.getName().toLowerCase();
            if (Build.VERSION.SDK_INT >= 29 ? !info.isHardwareAccelerated() : n.startsWith("omx.google.") || n.startsWith("c2.android.")) continue;
            for (String t : info.getSupportedTypes()) {
                if (!t.equalsIgnoreCase(mime)) continue;
                try {
                    MediaCodecInfo.VideoCapabilities v = info.getCapabilitiesForType(t).getVideoCapabilities();
                    int[] size = v.isSizeSupported(3840, 2160) ? new int[] {3840, 2160}
                            : v.isSizeSupported(1920, 1080) ? new int[] {1920, 1080} : new int[] {1280, 720};
                    if (best == null || size[0] > best[0]) best = size;
                } catch (RuntimeException ignored) {
                }
            }
        }
        return best;
    }

    static String link(Context c) {
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            NetworkCapabilities nc = n == null ? null : cm.getNetworkCapabilities(n);
            if (nc == null) return "unknown";
            if (nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
            if (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        } catch (RuntimeException ignored) {
        }
        return "unknown";
    }

    static String deviceName(Context c) {
        String n = null;
        try { n = Settings.Global.getString(c.getContentResolver(), "device_name"); } catch (RuntimeException ignored) { }
        return n == null || n.isEmpty() ? Build.MODEL : n;
    }
}
