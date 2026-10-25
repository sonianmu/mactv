package tv.mactv.receiver;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.PixelCopy;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * The Mac's session on the TV (Link has the stream). Full screen video on a SurfaceView, which goes to the TV's
 * own video plane at the stream's full resolution (a TextureView would be composited at the UI's 1080p).
 *
 * The remote has two modes. Pointer mode: the arrows move a cursor the TV draws, faster while held, and OK
 * clicks; works in any app. Key mode: arrows, OK and back go to the Mac as keys. Pages built for a remote
 * (the Mac says so in its status) always get keys. Back goes back a page, play/pause and seek control playback,
 * channel up/down scroll, the menu key opens the menu, holding back leaves.
 */
public final class ReceiverActivity extends Activity implements SurfaceHolder.Callback, Link.Listener {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private float u;
    private Store store;
    private Link link;
    private SurfaceView video;
    private CursorView cursor;
    private MenuBar menu;
    private LostView lost;
    private LinearLayout panel;
    private TextView title, detail, toast;
    private boolean everPlayed, live, backLong, keyboardAsked, pairing;
    private volatile boolean remotePage;
    /** A page or album asked for by whoever opened us (intent extras "app", "play"); sent once the picture is up. */
    private String startPage, startPlay;
    private AlertDialog keyboard;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        u = getResources().getDisplayMetrics().widthPixels / 1920f;
        store = new Store(this);
        startPage = getIntent().getStringExtra("app");
        startPlay = getIntent().getStringExtra("play");
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);
        video = new SurfaceView(this);
        video.getHolder().addCallback(this);
        // Buffers at the stream's size rather than the view's (the UI's 1080p), so 4K stays 4K.
        video.getHolder().setFixedSize(3840, 2160);
        root.addView(video, new FrameLayout.LayoutParams(-1, -1));
        cursor = new CursorView(this);
        root.addView(cursor, new FrameLayout.LayoutParams(-1, -1));

        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_HORIZONTAL);
        title = text(46, 0xF2FFFFFF);
        panel.addView(title);
        detail = text(26, 0x99FFFFFF);
        LinearLayout.LayoutParams dp = new LinearLayout.LayoutParams(-2, -2);
        dp.topMargin = Math.round(16 * u);
        panel.addView(detail, dp);
        root.addView(panel, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));

        toast = text(26, 0xF2FFFFFF);
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(0xB3141416);
        pill.setCornerRadius(40 * u);
        toast.setBackground(pill);
        toast.setPadding(Math.round(36 * u), Math.round(16 * u), Math.round(36 * u), Math.round(16 * u));
        toast.setAlpha(0f);
        FrameLayout.LayoutParams tp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        tp.topMargin = Math.round(56 * u);
        root.addView(toast, tp);

        menu = new MenuBar(this);
        menu.setPointerMode(store.pointer());
        root.addView(menu, new FrameLayout.LayoutParams(-1, -1));
        lost = new LostView(this, new LostView.Actions() {
            @Override public void exit() { finish(); }
            @Override public void wakeAndRetry() { Net.wake(store.wake()); say(getString(R.string.woke)); }
        });
        root.addView(lost, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        link = new Link(this, store, this);
        onState("connecting", null);
    }

    private TextView text(float size, int color) {
        TextView t = new TextView(this);
        t.setTextColor(color);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, size * u);
        t.setGravity(Gravity.CENTER_HORIZONTAL);
        return t;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Coming back this arrives before onStart, while the link is down; a command sent then is dropped.
        String page = intent.getStringExtra("app"), play = intent.getStringExtra("play");
        if (live) {
            if (page != null) link.send("app " + page);
            if (play != null) link.send("play " + play);
        } else {
            if (page != null) startPage = page;
            if (play != null) startPlay = play;
        }
    }

    @Override protected void onStart() { super.onStart(); link.start(); }

    @Override
    protected void onStop() {
        live = false;
        link.stop();
        super.onStop();
    }

    @Override public void surfaceCreated(SurfaceHolder h) { link.setSurface(h.getSurface()); }
    @Override public void surfaceChanged(SurfaceHolder h, int format, int w, int hh) { }
    @Override public void surfaceDestroyed(SurfaceHolder h) { link.setSurface(null); }

    private void lastFrame(java.util.function.Consumer<Bitmap> done) {
        Bitmap b = Bitmap.createBitmap(480, 270, Bitmap.Config.ARGB_8888);
        try {
            PixelCopy.request(video, b, r -> done.accept(r == PixelCopy.SUCCESS ? b : null), ui);
        } catch (RuntimeException e) {
            done.accept(null);
        }
    }

    // MARK: what the link reports

    private String reason(String why) {
        if ("stalled".equals(why)) return getString(R.string.why_stalled);
        if ("noscreen".equals(why)) return getString(R.string.why_noscreen);
        return getString(R.string.why_nomac);
    }

    @Override
    public void onState(String state, String info) {
        runOnUiThread(() -> {
            switch (state) {
                case "searching": status(getString(R.string.searching), getString(R.string.searching_detail)); break;
                case "connecting": status(getString(R.string.connecting), info == null ? "" : info); break;
                case "waiting": status(getString(R.string.connected), getString(R.string.waiting)); break;
                case "nodecoder": status(getString(R.string.nodecoder), getString(R.string.nodecoder_detail)); break;
                case "pair":
                    status(getString(R.string.pair_title), getString(R.string.pair_detail));
                    askPin(info);
                    break;
                case "lost":
                    live = false;
                    cursor.hide();
                    String why = reason(info);
                    if (everPlayed) { menu.close(); if (!lost.isUp()) lastFrame(b -> lost.show(b, why)); else lost.setReason(why); }
                    else status(getString(R.string.lost_title), why);
                    break;
                case "playing":
                    everPlayed = true;
                    live = true;
                    lost.hide();
                    panel.animate().alpha(0f).setDuration(300).start();
                    if (startPage != null) { link.send("app " + startPage); startPage = null; }
                    if (startPlay != null) { link.send("play " + startPlay); startPlay = null; }
                    say(getString(R.string.first_hint));
                    break;
                default: break;
            }
        });
    }

    private void status(String t, String d) {
        title.setText(t);
        detail.setText(d);
        panel.animate().cancel();
        panel.setAlpha(1f);
    }

    @Override
    public void onStatus(String app, boolean remote, boolean wantsKeyboard) {
        runOnUiThread(() -> {
            menu.setFront(app);
            remotePage = remote;
            if (remote) cursor.hide();
            // Open once per request; the page clears its request when it is done.
            if (wantsKeyboard && !keyboardAsked && (keyboard == null || !keyboard.isShowing())) typeText();
            keyboardAsked = wantsKeyboard;
        });
    }

    @Override
    public void onApps(List<String> apps) { runOnUiThread(() -> menu.setApps(apps)); }

    private void say(String message) {
        toast.setText(message);
        toast.animate().cancel();
        toast.setAlpha(0f);
        toast.animate().alpha(1f).setDuration(200).withEndAction(
                () -> toast.animate().alpha(0f).setStartDelay(2600).setDuration(400).start()).start();
    }

    // MARK: pairing and settings

    /** Asks for the PIN that `mactv pair` shows on the Mac, then pairs in the background. */
    private void askPin(String refusedBecause) {
        if (pairing) return;
        pairing = true;
        EditText field = new EditText(this);
        field.setInputType(InputType.TYPE_CLASS_NUMBER);
        field.setTextSize(TypedValue.COMPLEX_UNIT_PX, 40 * u);
        String msg = getString(R.string.pair_detail) + ("wrong-pin".equals(refusedBecause) ? "\n" + getString(R.string.pair_wrong) : "");
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(R.string.pair_title).setMessage(msg).setView(field)
                .setPositiveButton(R.string.pair_ok, (d, w) -> {
                    String pin = field.getText().toString().trim();
                    new Thread(() -> {
                        String host = store.manualHost() != null ? store.manualHost() : store.host();
                        String r = host == null ? null : Net.pair(host, pin, Caps.deviceName(this));
                        runOnUiThread(() -> {
                            pairing = false;
                            if (r == null) { say(getString(R.string.why_nomac)); askPin(null); }
                            else if (r.startsWith("!")) askPin(r.substring(1));
                            else { store.setToken(r); say(getString(R.string.paired)); link.paired(); }
                        });
                    }, "pair").start();
                })
                .setNeutralButton(R.string.settings_address, (d, w) -> { pairing = false; askAddress(); })
                .setOnCancelListener(d -> { pairing = false; finish(); })
                .show();
    }

    /** The Mac's address by hand, for networks where the sweep can't find it (other subnet, isolation). */
    private void askAddress() {
        EditText field = new EditText(this);
        field.setInputType(InputType.TYPE_CLASS_TEXT);
        field.setHint("192.168.x.x");
        if (store.manualHost() != null) field.setText(store.manualHost());
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(R.string.settings_address).setView(field)
                .setPositiveButton(android.R.string.ok, (d, w) -> { store.setManualHost(field.getText().toString()); restartLink(); })
                .setNegativeButton(android.R.string.cancel, null).show();
    }

    private void settings() {
        String[] items = {getString(R.string.settings_address), getString(R.string.settings_forget)};
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(R.string.menu_settings)
                .setItems(items, (d, which) -> {
                    if (which == 0) askAddress();
                    else { store.forget(); restartLink(); }
                }).show();
    }

    private void restartLink() {
        link.stop();
        link = new Link(this, store, this);
        link.start();
        link.setSurface(video.getHolder().getSurface());
    }

    // MARK: the remote

    private static boolean isMenu(int k) { return k == KeyEvent.KEYCODE_MENU || k == KeyEvent.KEYCODE_INFO || k == KeyEvent.KEYCODE_GUIDE; }
    private static boolean isOk(int k) { return k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_NUMPAD_ENTER; }

    private void act(String id) {
        menu.close();
        switch (id) {
            case MenuBar.MODE:
                store.setPointer(!store.pointer());
                menu.setPointerMode(store.pointer());
                say(getString(store.pointer() ? R.string.mode_pointer : R.string.mode_keys));
                break;
            case MenuBar.KEYBOARD: typeText(); break;
            case MenuBar.FILL: link.send("fill"); break;
            case MenuBar.SETTINGS: settings(); break;
            default: link.send("app " + id); break;
        }
    }

    /** The TV's own input method in a dialog; the text goes to the Mac's focused field (any language). */
    private void typeText() {
        EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setTextSize(TypedValue.COMPLEX_UNIT_PX, 32 * u);
        field.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        AlertDialog d = keyboard = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(remotePage ? R.string.search : R.string.type_to_mac).setView(field)
                .setPositiveButton(R.string.send, (x, w) -> sendText(field.getText().toString()))
                .setNegativeButton(android.R.string.cancel, null).create();
        field.setOnEditorActionListener((v, action, ev) -> { sendText(field.getText().toString()); d.dismiss(); return true; });
        d.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        d.show();
        field.requestFocus();
    }

    private void sendText(String text) {
        link.send(text.isEmpty() ? "key select" : "text " + Base64.encodeToString(text.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP) + " enter");
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (lost.isUp()) {
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) lost.key(e.getKeyCode());
            return e.getKeyCode() != KeyEvent.KEYCODE_HOME;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent e) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (e.getRepeatCount() == 0) { backLong = false; e.startTracking(); }
            return true;
        }
        if (isMenu(keyCode)) {
            if (e.getRepeatCount() == 0) { if (menu.isOpen()) menu.close(); else menu.open(); }
            return true;
        }
        if (menu.isOpen()) {
            if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) menu.move(-1);
            else if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) menu.move(1);
            else if (keyCode == KeyEvent.KEYCODE_DPAD_UP) menu.close();
            else if (isOk(keyCode) && e.getRepeatCount() == 0) act(menu.selectedId());
            return true;
        }
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                if (e.getRepeatCount() == 0) link.send("key playpause");
                return true;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: link.send("key next"); return true;
            case KeyEvent.KEYCODE_MEDIA_REWIND: link.send("key previous"); return true;
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_PAGE_UP: link.send("scroll -4"); return true;
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_PAGE_DOWN: link.send("scroll 4"); return true;
            default: break;
        }
        int dx = 0, dy = 0;
        if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) dx = -1;
        else if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) dx = 1;
        else if (keyCode == KeyEvent.KEYCODE_DPAD_UP) dy = -1;
        else if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN) dy = 1;
        boolean pointer = store.pointer() && !remotePage;
        if (dx != 0 || dy != 0) {
            if (pointer) {
                // Fine at first, then faster while held.
                float step = Math.min(14 + 10 * e.getRepeatCount(), 70);
                cursor.moveTo(cursor.px() + dx * step, cursor.py() + dy * step);
                link.send("move " + Math.round(cursor.px()) + " " + Math.round(cursor.py()));
            } else {
                link.send("key " + (dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "up" : "down"));
            }
            return true;
        }
        if (isOk(keyCode)) {
            if (e.getRepeatCount() == 0) {
                if (pointer) { link.send("click"); cursor.pulse(); } else link.send("key select");
            }
            return true;
        }
        return super.onKeyDown(keyCode, e);
    }

    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent e) {
        if (keyCode == KeyEvent.KEYCODE_BACK) { backLong = true; finish(); return true; }
        return super.onKeyLongPress(keyCode, e);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent e) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (!backLong && !e.isCanceled()) { if (menu.isOpen()) menu.close(); else link.send("key back"); }
            return true;
        }
        return super.onKeyUp(keyCode, e);
    }
}
