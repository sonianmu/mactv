package tv.mactv.receiver;

import android.content.Context;
import android.content.SharedPreferences;

/** What the TV remembers about its Mac: address, pairing token, hardware address for waking it, pointer mode. */
final class Store {
    private final SharedPreferences p;

    Store(Context c) { p = c.getSharedPreferences("mactv", Context.MODE_PRIVATE); }

    /** An address typed in the settings; wins over discovery. */
    String manualHost() { return p.getString("manual", null); }
    void setManualHost(String h) { p.edit().putString("manual", h == null || h.trim().isEmpty() ? null : h.trim()).apply(); }

    String host() { return p.getString("host", null); }
    void setHost(String h) { p.edit().putString("host", h).apply(); }

    String token() { return p.getString("token", null); }
    void setToken(String t) { p.edit().putString("token", t).apply(); }

    String wake() { return p.getString("wake", null); }
    void setWake(String m) { if (m != null) p.edit().putString("wake", m).apply(); }

    String macName() { return p.getString("name", "Mac"); }
    void setMacName(String n) { if (n != null) p.edit().putString("name", n).apply(); }

    boolean pointer() { return p.getBoolean("pointer", true); }
    void setPointer(boolean on) { p.edit().putBoolean("pointer", on).apply(); }

    void forget() { p.edit().remove("token").remove("host").remove("wake").apply(); }
}
