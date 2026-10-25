package tv.mactv.receiver;

import android.content.Context;
import android.graphics.BlurMaskFilter;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.View;

/**
 * The pointer for pointer mode, drawn by the TV over the Mac's picture (the Mac's own cursor is not captured):
 * a macOS-style arrow, white with a dark rim and a soft shadow, sized for viewing across a room. Position is
 * in the Mac display's points (1920 x 1080 for a 16:9 session), mapped onto the TV's width. It fades out when
 * left alone, and a click pulses a ring around the tip.
 */
final class CursorView extends View {
    private static final long IDLE_MS = 3000;
    private final float u;
    private final Path arrow = new Path();
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG), rim = new Paint(Paint.ANTI_ALIAS_FLAG),
            shadow = new Paint(Paint.ANTI_ALIAS_FLAG), ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Runnable fade = () -> animate().alpha(0f).setDuration(600).start();
    private float x = 960, y = 540, pulse;

    CursorView(Context c) {
        super(c);
        u = c.getResources().getDisplayMetrics().widthPixels / 1920f;
        setLayerType(LAYER_TYPE_SOFTWARE, null);  // BlurMaskFilter
        // Tip at the origin; 1 unit = 1 stage pixel, scaled up 1.6x from the Mac's 1x arrow.
        float s = 1.6f;
        arrow.moveTo(0, 0);
        arrow.lineTo(0, 26 * s);
        arrow.lineTo(6.2f * s, 20.4f * s);
        arrow.lineTo(10.4f * s, 30 * s);
        arrow.lineTo(14.6f * s, 28.2f * s);
        arrow.lineTo(10.6f * s, 18.8f * s);
        arrow.lineTo(18.6f * s, 18.6f * s);
        arrow.close();
        fill.setColor(0xFFFFFFFF);
        rim.setColor(0xFF111111);
        rim.setStyle(Paint.Style.STROKE);
        rim.setStrokeWidth(2.4f);
        rim.setStrokeJoin(Paint.Join.ROUND);
        shadow.setColor(0x66000000);
        shadow.setMaskFilter(new BlurMaskFilter(6 * u, BlurMaskFilter.Blur.NORMAL));
        ring.setStyle(Paint.Style.STROKE);
        ring.setColor(0xFFFFFFFF);
        ring.setStrokeWidth(4 * u);
        setAlpha(0f);
    }

    float px() { return x; }
    float py() { return y; }

    /** Moves the tip to (x, y) in display points, clamped to the screen, and wakes the cursor. */
    void moveTo(float nx, float ny) {
        x = Math.max(0, Math.min(1919, nx));
        y = Math.max(0, Math.min(1079, ny));
        show();
        invalidate();
    }

    void show() {
        animate().cancel();
        setAlpha(1f);
        removeCallbacks(fade);
        postDelayed(fade, IDLE_MS);
    }

    void hide() {
        removeCallbacks(fade);
        animate().cancel();
        setAlpha(0f);
    }

    /** A ring that grows and fades from the tip: the click was sent. */
    void pulse() {
        show();
        android.animation.ValueAnimator a = android.animation.ValueAnimator.ofFloat(0f, 1f).setDuration(320);
        a.addUpdateListener(v -> { pulse = (float) v.getAnimatedValue(); invalidate(); });
        a.start();
    }

    @Override
    protected void onDraw(Canvas c) {
        float sx = x * u, sy = y * u;
        if (pulse > 0 && pulse < 1) {
            ring.setAlpha(Math.round(200 * (1 - pulse)));
            c.drawCircle(sx, sy, (10 + 40 * pulse) * u, ring);
        }
        c.save();
        c.translate(sx, sy);
        c.scale(u, u);
        c.save();
        c.translate(1.5f, 3f);
        c.drawPath(arrow, shadow);
        c.restore();
        c.drawPath(arrow, fill);
        c.drawPath(arrow, rim);
        c.restore();
    }
}
