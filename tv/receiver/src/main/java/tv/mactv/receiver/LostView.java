package tv.mactv.receiver;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;

/**
 * Shown when the Mac goes away mid-use: the last frame, blurred and darkened, the reason (which link broke)
 * and two capsules, "Exit" (selected, counting down) and "Wake the Mac and retry". Ten seconds without a key
 * exits on its own. The link keeps retrying underneath; if the picture comes back this simply hides.
 */
final class LostView extends View {
    interface Actions { void exit(); void wakeAndRetry(); }

    private static final int SECONDS = 10;
    private final float u;
    private final Actions actions;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Paint img = new Paint(Paint.FILTER_BITMAP_FLAG), dark = new Paint(), title = new Paint(Paint.ANTI_ALIAS_FLAG),
            body = new Paint(Paint.ANTI_ALIAS_FLAG), btn = new Paint(Paint.ANTI_ALIAS_FLAG), text = new Paint(Paint.ANTI_ALIAS_FLAG),
            edge = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Runnable tick = this::tick;
    private Bitmap frame;
    private String reason = "";
    private int choice, left;
    private boolean shown;

    LostView(Context c, Actions a) {
        super(c);
        u = c.getResources().getDisplayMetrics().widthPixels / 1920f;
        actions = a;
        dark.setColor(0xA6000000);
        title.setColor(0xFFFFFFFF);
        title.setTextSize(50 * u);
        title.setTextAlign(Paint.Align.CENTER);
        body.setColor(0xB3FFFFFF);
        body.setTextSize(24 * u);
        body.setTextAlign(Paint.Align.CENTER);
        text.setTextSize(26 * u);
        edge.setStyle(Paint.Style.STROKE);
        edge.setStrokeWidth(2 * u);
        edge.setColor(0x80FFFFFF);
        setVisibility(GONE);
    }

    boolean isUp() { return shown; }

    void setReason(String r) { reason = r == null ? "" : r; invalidate(); }

    /** last: the last decoded frame, or null. A tiny copy scaled back up reads as a soft blur. */
    void show(Bitmap last, String why) {
        reason = why == null ? "" : why;
        frame = last == null ? null : Bitmap.createScaledBitmap(last, 48, 27, true);
        choice = 0;
        left = SECONDS;
        shown = true;
        setAlpha(0f);
        setVisibility(VISIBLE);
        animate().alpha(1f).setDuration(300).start();
        ui.removeCallbacks(tick);
        ui.postDelayed(tick, 1000);
        invalidate();
    }

    void hide() {
        if (!shown) return;
        shown = false;
        ui.removeCallbacks(tick);
        animate().alpha(0f).setDuration(250).withEndAction(() -> setVisibility(GONE)).start();
    }

    private void tick() {
        if (!shown) return;
        if (--left <= 0) { actions.exit(); return; }
        invalidate();
        ui.postDelayed(tick, 1000);
    }

    /** Left/right pick, OK acts, back exits. Any key restarts the count. */
    void key(int code) {
        left = SECONDS;
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_LEFT: choice = 0; break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: choice = 1; break;
            case KeyEvent.KEYCODE_BACK: actions.exit(); return;
            case KeyEvent.KEYCODE_DPAD_CENTER: case KeyEvent.KEYCODE_ENTER:
                if (choice == 0) actions.exit(); else actions.wakeAndRetry();
                break;
            default: break;
        }
        invalidate();
    }

    @Override
    protected void onDraw(Canvas c) {
        int w = getWidth(), h = getHeight();
        if (frame != null) c.drawBitmap(frame, null, new RectF(0, 0, w, h), img);
        else c.drawColor(0xFF0D0D0F);
        c.drawRect(0, 0, w, h, dark);
        float cx = w / 2f;
        c.drawText(getContext().getString(R.string.lost_title), cx, 470 * u, title);
        c.drawText(reason, cx, 535 * u, body);
        String a = getContext().getString(R.string.lost_exit) + "  " + left, b = getContext().getString(R.string.lost_wake);
        float pad = 36 * u, bh = 64 * u, gap = 18 * u;
        float aw = pad * 2 + text.measureText(a), bw = pad * 2 + text.measureText(b);
        float x0 = cx - (aw + gap + bw) / 2f, top = 610 * u;
        capsule(c, new RectF(x0, top, x0 + aw, top + bh), a, choice == 0);
        capsule(c, new RectF(x0 + aw + gap, top, x0 + aw + gap + bw, top + bh), b, choice == 1);
    }

    private void capsule(Canvas c, RectF r, String label, boolean on) {
        float rad = r.height() / 2;
        if (on) { btn.setColor(0xFFF2F2F2); c.drawRoundRect(r, rad, rad, btn); } else c.drawRoundRect(r, rad, rad, edge);
        text.setColor(on ? 0xFF111111 : 0xFFFFFFFF);
        Paint.FontMetrics m = text.getFontMetrics();
        c.drawText(label, r.left + 36 * u, r.centerY() - (m.ascent + m.descent) / 2, text);
    }
}
