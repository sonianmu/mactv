package tv.mactv.receiver;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * The menu (menu key): a row of capsules along the bottom over a dark gradient. The Mac's desktop and pages
 * (from its Welcome), the TV keyboard, "fill window", pointer/key mode and settings. The selected capsule is
 * filled; a dot marks the page in front on the Mac. Sizes are in 1920-wide stage units.
 */
final class MenuBar extends FrameLayout {
    static final String DESKTOP = "desktop", KEYBOARD = "keyboard", FILL = "fill", MODE = "mode", SETTINGS = "settings";

    private final float u;
    private final LinearLayout row;
    private final Paint shade = new Paint();
    private final List<String> ids = new ArrayList<>();
    private final List<TextView> items = new ArrayList<>();
    private int selected;
    private boolean open, pointerMode = true;
    private String front = "";
    private List<String> apps = new ArrayList<>();
    /** Menu names the Mac gave its pages (Welcome "titles"). */
    static final java.util.Map<String, String> titles = new java.util.HashMap<>();

    MenuBar(Context c) {
        super(c);
        u = c.getResources().getDisplayMetrics().widthPixels / 1920f;
        setWillNotDraw(false);
        row = new LinearLayout(c);
        row.setGravity(Gravity.CENTER);
        LayoutParams rp = new LayoutParams(-1, -2, Gravity.BOTTOM);
        rp.bottomMargin = Math.round(130 * u);
        addView(row, rp);
        TextView hint = new TextView(c);
        hint.setTextColor(0x80FFFFFF);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_PX, 22 * u);
        hint.setText(R.string.menu_hint);
        LayoutParams hp = new LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        hp.bottomMargin = Math.round(60 * u);
        addView(hint, hp);
        build();
        setAlpha(0f);
        setVisibility(GONE);
    }

    static String label(Context c, String id) {
        switch (id) {
            case DESKTOP: return c.getString(R.string.menu_desktop);
            case KEYBOARD: return c.getString(R.string.menu_keyboard);
            case FILL: return c.getString(R.string.menu_fill);
            case SETTINGS: return c.getString(R.string.menu_settings);
            default:
                if (titles.containsKey(id)) return titles.get(id);
                return id.isEmpty() ? id : Character.toUpperCase(id.charAt(0)) + id.substring(1);
        }
    }

    private void build() {
        row.removeAllViews();
        ids.clear();
        items.clear();
        ids.add(DESKTOP);
        ids.addAll(apps);
        ids.add(KEYBOARD);
        ids.add(FILL);
        ids.add(MODE);
        ids.add(SETTINGS);
        for (String id : ids) {
            TextView t = new TextView(getContext());
            t.setTextSize(TypedValue.COMPLEX_UNIT_PX, 28 * u);
            t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            t.setSingleLine(true);
            t.setPadding(Math.round(36 * u), Math.round(18 * u), Math.round(36 * u), Math.round(18 * u));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
            lp.leftMargin = lp.rightMargin = Math.round(10 * u);
            row.addView(t, lp);
            items.add(t);
        }
        selected = Math.min(selected, ids.size() - 1);
        paint();
    }

    private void paint() {
        for (int i = 0; i < ids.size(); i++) {
            String id = ids.get(i);
            TextView t = items.get(i);
            String text = id.equals(MODE) ? getContext().getString(pointerMode ? R.string.menu_pointer : R.string.menu_keys) : label(getContext(), id);
            t.setText(id.equals(front) ? text + "  •" : text);
            boolean on = open && i == selected;
            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(40 * u);
            bg.setColor(on ? 0xFFF2F2F2 : 0x33FFFFFF);
            t.setBackground(bg);
            t.setTextColor(on ? 0xFF111111 : 0xD9FFFFFF);
            t.setScaleX(on ? 1.06f : 1f);
            t.setScaleY(on ? 1.06f : 1f);
        }
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        shade.setShader(new LinearGradient(0, h - 460 * u, 0, h, new int[] {0x00000000, 0x99000000, 0xD9000000},
                new float[] {0f, .55f, 1f}, Shader.TileMode.CLAMP));
    }

    @Override
    protected void onDraw(Canvas c) { c.drawRect(0, getHeight() - 460 * u, getWidth(), getHeight(), shade); }

    boolean isOpen() { return open; }

    void open() {
        if (open) return;
        open = true;
        setVisibility(VISIBLE);
        animate().alpha(1f).setDuration(220).start();
        paint();
    }

    void close() {
        if (!open) return;
        open = false;
        animate().alpha(0f).setDuration(180).withEndAction(() -> setVisibility(GONE)).start();
    }

    void move(int d) {
        selected = Math.max(0, Math.min(ids.size() - 1, selected + d));
        paint();
    }

    String selectedId() { return ids.get(selected); }

    void setFront(String app) { front = app; paint(); }

    void setApps(List<String> a) { apps = new ArrayList<>(a); build(); }

    void setPointerMode(boolean on) { pointerMode = on; paint(); }
}
