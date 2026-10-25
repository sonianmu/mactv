// Apple Music for the TV, laid over Apple's web player (music.apple.com) in the mactv session and modelled on
// the Music app for tvOS: a centred tab bar that slides away as you scroll, rows of large artwork that lift
// when focused, the Library as a list of kinds beside a grid, album pages with the artwork on the left, and a
// full-screen Now Playing over the blurred cover. Everything plays through the page's own MusicKit, so the
// account and the whole catalog are Apple's.
// Keys (from the TV remote via MacTV): arrows move, Enter opens/plays, Escape goes back, Space plays/pauses,
// n / p next and previous track. In the full player: up to the star and More, down to the volume. Injected through the DevTools port; a second injection does nothing.
(() => {
  // A newer copy replaces an older one already on the page; the same copy injected twice does nothing.
  const VERSION = 10;
  if (window.__tvui >= VERSION) return;
  if (window.__tvui) { const old = document.getElementById('tvui'); if (old) old.remove(); location.reload(); return; }
  window.__tvui = VERSION;

  const PINK = '#FA2D48';
  const css = `
  #tvui{position:fixed;inset:0;z-index:2147483647;background:#0b0b0d;color:#fff;overflow:hidden;cursor:none;
    font-family:-apple-system,"SF Pro Display","SF Pro Text","PingFang SC",sans-serif;-webkit-font-smoothing:antialiased}
  #tvui *{box-sizing:border-box}
  #tvui .bg{position:absolute;inset:-80px;background:#0b0b0d center/cover;filter:blur(90px) saturate(1.3) brightness(.45);
    transform:scale(1.15);transition:opacity 700ms ease;opacity:0}
  #tvui .bg.on{opacity:1}
  #tvui .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,11,13,.2) 0%,rgba(11,11,13,.55) 60%,rgba(11,11,13,.85) 100%)}

  #tvui .tabs{position:absolute;left:0;right:0;top:42px;display:flex;justify-content:center;transition:transform 380ms cubic-bezier(.2,.7,.2,1),opacity 300ms}
  #tvui .tabs.away{transform:translateY(-120px);opacity:0}
  #tvui .tabbar{display:flex;align-items:center;gap:6px;padding:6px;border-radius:999px;background:rgba(255,255,255,.08);backdrop-filter:blur(30px)}
  #tvui .tab{height:52px;padding:0 28px;border-radius:26px;display:flex;align-items:center;gap:10px;font-size:23px;font-weight:600;color:rgba(255,255,255,.62);transition:all 200ms}
  #tvui .tab.on{color:#fff}
  #tvui .tab.focus{background:#fff;color:#111;transform:scale(1.06);box-shadow:0 10px 30px rgba(0,0,0,.35)}
  #tvui .tab svg{width:24px;height:24px}

  #tvui .page{position:absolute;left:0;right:0;top:0;bottom:0;overflow:hidden}
  #tvui .scroll{position:absolute;left:0;right:0;top:150px;transition:transform 420ms cubic-bezier(.2,.7,.2,1)}

  #tvui .shelf{position:relative;padding-left:90px}
  #tvui .shelf h2{margin:0;height:58px;font-size:29px;font-weight:700;letter-spacing:-.005em;display:flex;align-items:flex-end;padding-bottom:16px}
  #tvui .track{display:flex;gap:44px;transition:transform 420ms cubic-bezier(.2,.7,.2,1)}
  #tvui .card{flex:0 0 auto}
  #tvui .art{border-radius:12px;background:#26262a center/cover no-repeat;transition:transform 260ms cubic-bezier(.2,.7,.2,1),box-shadow 260ms;position:relative;overflow:hidden}
  #tvui .art:after{content:"";position:absolute;inset:0;border-radius:inherit;opacity:0;transition:opacity 260ms;
    background:linear-gradient(155deg,rgba(255,255,255,.28) 0%,rgba(255,255,255,0) 42%)}
  #tvui .card.focus .art{transform:scale(1.1);box-shadow:0 34px 60px rgba(0,0,0,.55)}
  #tvui .card.focus .art:after{opacity:1}
  #tvui .cap{transition:transform 260ms cubic-bezier(.2,.7,.2,1)}
  #tvui .card.focus .cap{transform:translateY(16px)}
  #tvui .c1{margin-top:20px;font-size:21px;font-weight:600;color:rgba(255,255,255,.88);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #tvui .c2{margin-top:4px;font-size:18px;color:rgba(255,255,255,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #tvui .card.focus .c1{color:#fff}

  #tvui .side{position:absolute;left:90px;top:150px;width:330px}
  #tvui .side .it{height:62px;display:flex;align-items:center;gap:16px;padding:0 24px;border-radius:14px;font-size:24px;font-weight:600;color:rgba(255,255,255,.62);transition:all 200ms}
  #tvui .side .it.on{color:#fff}
  #tvui .side .it.focus{background:#fff;color:#111;transform:scale(1.04);box-shadow:0 10px 26px rgba(0,0,0,.35)}
  #tvui .grid{position:absolute;left:480px;right:60px;top:150px;bottom:0;overflow:hidden}
  #tvui .grid .in{display:grid;grid-template-columns:repeat(5,236px);gap:56px 46px;padding:20px 0 120px 20px;transition:transform 420ms cubic-bezier(.2,.7,.2,1)}

  #tvui .album{position:absolute;inset:0;display:flex;gap:80px;padding:120px 90px 0 120px}
  #tvui .album .left{width:520px;flex:0 0 520px}
  #tvui .album .cover{width:520px;height:520px;border-radius:14px;background:#26262a center/cover;box-shadow:0 30px 70px rgba(0,0,0,.55)}
  #tvui .album h1{margin:34px 0 0;font-size:36px;font-weight:700;line-height:1.2}
  #tvui .album .by{margin-top:8px;font-size:24px;color:${PINK};font-weight:600}
  #tvui .album .meta{margin-top:8px;font-size:18px;color:rgba(255,255,255,.5);letter-spacing:.02em}
  #tvui .btns{display:flex;gap:18px;margin-top:30px}
  #tvui .btn{height:62px;padding:0 34px;border-radius:14px;display:flex;align-items:center;gap:12px;font-size:22px;font-weight:600;
    background:rgba(255,255,255,.14);color:#fff;transition:all 200ms}
  #tvui .btn.focus{background:#fff;color:#111;transform:scale(1.06);box-shadow:0 14px 30px rgba(0,0,0,.4)}
  #tvui .btn svg{width:20px;height:20px}
  #tvui .tracks{flex:1;position:relative;overflow:hidden;height:780px}
  #tvui .tracks .in{transition:transform 360ms cubic-bezier(.2,.7,.2,1)}
  #tvui .tr{height:76px;display:flex;align-items:center;gap:24px;padding:0 26px;border-radius:14px;font-size:22px;transition:background 160ms,transform 160ms;border-bottom:1px solid rgba(255,255,255,.07)}
  #tvui .tr .n{width:36px;color:rgba(255,255,255,.45);font-variant-numeric:tabular-nums;font-size:20px}
  #tvui .tr .nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
  #tvui .tr .ar{display:block;font-size:17px;color:rgba(255,255,255,.5);margin-top:3px;font-weight:400}
  #tvui .tr .d{color:rgba(255,255,255,.45);font-size:19px;font-variant-numeric:tabular-nums}
  #tvui .tr.focus{background:#fff;color:#111;border-bottom-color:transparent;transform:scale(1.02)}
  #tvui .tr.focus .n,#tvui .tr.focus .d,#tvui .tr.focus .ar{color:rgba(17,17,17,.55)}
  #tvui .tr.playing .n,#tvui .tr.loading .n{color:${PINK};font-size:0}
  #tvui .tr.playing .n:before{content:"";display:inline-block;width:18px;height:16px;
    background:linear-gradient(${PINK},${PINK}) 0 100%/4px 60% no-repeat,linear-gradient(${PINK},${PINK}) 7px 100%/4px 100% no-repeat,linear-gradient(${PINK},${PINK}) 14px 100%/4px 40% no-repeat}
  #tvui .tr.loading .n:before{content:"";display:inline-block;width:16px;height:16px;border-radius:50%;
    border:2.5px solid rgba(250,45,72,.3);border-top-color:${PINK};animation:tvspin 700ms linear infinite}
  #tvui .tr.focus.playing .n:before,#tvui .tr.focus.loading .n:before{filter:none}
  @keyframes tvspin{to{transform:rotate(360deg)}}

  /* full player, as Apple Music's: a left column (cover; title and artist with star and more; scrubber with
     a knob; times; shuffle, back, play, forward, repeat; volume) and timed lyrics on the right, over the
     cover's colours blurred into a slowly drifting wash */
  #tvui .np{position:absolute;inset:0}
  #tvui .np .wash{position:absolute;inset:-25%;background:#222 center/cover;filter:blur(140px) saturate(1.5) brightness(.7);animation:tvdrift 30s ease-in-out infinite alternate}
  @keyframes tvdrift{from{transform:rotate(0deg) scale(1.15)}to{transform:rotate(14deg) scale(1.3)}}
  #tvui .np .dim{position:absolute;inset:0;background:rgba(0,0,0,.18)}
  #tvui .np .col{position:absolute;left:230px;top:132px;width:620px}
  #tvui .np .cover{width:620px;height:620px;border-radius:10px;background:#26262a center/cover;box-shadow:0 24px 60px rgba(0,0,0,.35);transition:transform 450ms cubic-bezier(.2,.7,.2,1)}
  #tvui .np .cover.paused{transform:scale(.9)}
  #tvui .np .meta{display:flex;align-items:center;gap:14px;margin-top:28px}
  #tvui .np .meta .tx{flex:1;min-width:0}
  #tvui .np h1{margin:0;font-size:27px;font-weight:700;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #tvui .np .by{font-size:24px;color:rgba(255,255,255,.62);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #tvui .np .round{width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;flex:0 0 46px}
  #tvui .np .round svg{width:22px;height:22px}
  #tvui .np .round{transition:all 200ms}
  #tvui .np .round.on{color:${PINK}}
  #tvui .np .round.focus{background:rgba(255,255,255,.92);color:#111;transform:scale(1.12)}
  #tvui .np .round.focus.on{color:${PINK}}
  #tvui .np .scrub{position:relative;margin-top:30px;height:6px;border-radius:3px;background:rgba(255,255,255,.28)}
  #tvui .np .scrub i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:rgba(255,255,255,.75)}
  #tvui .np .scrub b{position:absolute;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#fff}
  #tvui .np .times{display:flex;justify-content:space-between;margin-top:12px;font-size:17px;color:rgba(255,255,255,.55);font-variant-numeric:tabular-nums;font-weight:500}
  #tvui .np .ctl{margin-top:12px;display:flex;justify-content:center;align-items:center;gap:30px}
  #tvui .np .ctl div{width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.92);transition:all 200ms}
  #tvui .np .ctl div svg{width:40px;height:40px}
  #tvui .np .ctl div.small svg{width:26px;height:26px}
  #tvui .np .ctl div.small{color:rgba(255,255,255,.6)}
  #tvui .np .ctl div.small.on{color:#fff}
  #tvui .np .ctl div.big svg{width:54px;height:54px}
  #tvui .np .ctl div.focus{background:rgba(255,255,255,.92);color:#111;transform:scale(1.08)}
  #tvui .np .vol{display:flex;align-items:center;gap:16px;margin-top:18px;color:rgba(255,255,255,.6)}
  #tvui .np .vol svg{width:22px;height:22px;flex:0 0 22px}
  #tvui .np .vol .scrub{margin:0;flex:1;transition:height 200ms,margin 200ms}
  #tvui .np .vol.focus{color:#fff}
  #tvui .np .vol.focus .scrub{height:12px;border-radius:6px}
  #tvui .np .vol.focus .scrub i{background:#fff;border-radius:6px}
  #tvui .np .vol .scrub b{transition:transform 200ms}
  #tvui .np .vol.focus .scrub b{transform:scale(1.5)}
  /* the More menu, as tvOS's: a frosted panel opening upward from the star and More, over the cover */
  #tvui .np .menu{position:absolute;left:230px;width:620px;bottom:318px;padding:10px;border-radius:24px;background:rgba(60,60,64,.72);
    backdrop-filter:blur(40px) saturate(1.8);box-shadow:0 24px 60px rgba(0,0,0,.45);opacity:0;transform:translateY(16px) scale(.98);
    transition:opacity 220ms,transform 260ms cubic-bezier(.2,.7,.2,1);pointer-events:none}
  #tvui .np .menu.open{opacity:1;transform:none}
  #tvui .np .menu .mi{height:66px;display:flex;align-items:center;gap:18px;padding:0 24px;border-radius:16px;font-size:23px;font-weight:600;color:rgba(255,255,255,.9);transition:all 160ms}
  #tvui .np .menu .mi svg{width:24px;height:24px;flex:0 0 24px}
  #tvui .np .menu .mi.focus{background:#fff;color:#111}
  #tvui .np .menu .mi.off{color:rgba(255,255,255,.4)}
  #tvui .np .menu .mi.off.focus{background:rgba(255,255,255,.3);color:rgba(17,17,17,.6)}
  #tvui .toast{position:absolute;left:50%;top:60px;transform:translate(-50%,-20px);padding:16px 30px;border-radius:999px;background:rgba(60,60,64,.8);
    backdrop-filter:blur(30px);font-size:22px;font-weight:600;opacity:0;transition:opacity 240ms,transform 300ms cubic-bezier(.2,.7,.2,1);z-index:5}
  #tvui .toast.on{opacity:1;transform:translate(-50%,0)}
  #tvui .np .lyr{position:absolute;left:1000px;right:100px;top:0;bottom:0;overflow:hidden;
    -webkit-mask-image:linear-gradient(180deg,transparent 0%,#000 20%,#000 72%,transparent 100%)}
  #tvui .np .lyr .in{position:absolute;left:0;right:0;top:0;transition:transform 800ms cubic-bezier(.2,.7,.2,1)}
  #tvui .np .ln{font-size:44px;font-weight:800;line-height:1.25;padding:16px 0;color:rgba(255,255,255,.34);transition:color 400ms,filter 400ms;filter:blur(1px);letter-spacing:-.01em}
  #tvui .np .ln.on{color:#fff;filter:none}
  #tvui .np .up h3{margin:0 0 18px;font-size:26px;font-weight:700}
  #tvui .np .up .q{display:flex;align-items:center;gap:20px;height:84px}
  #tvui .np .up .q .a{width:64px;height:64px;border-radius:8px;background:#333 center/cover;flex:0 0 64px}
  #tvui .np .up .q .t{font-size:22px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #tvui .np .up .q .s{font-size:18px;color:rgba(255,255,255,.55);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  /* mini player, as Apple Music's: a frosted capsule floating at the bottom centre, transport on the left,
     a small "display" with the cover, title, artist and a hairline of progress, then lyrics and queue */
  #tvui .mini{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);height:78px;border-radius:39px;
    background:rgba(52,52,56,.62);backdrop-filter:blur(36px) saturate(1.8);box-shadow:0 12px 40px rgba(0,0,0,.32),inset 0 0 0 1px rgba(255,255,255,.08);
    display:flex;align-items:center;gap:4px;padding:0 10px 0 14px;transition:transform 380ms cubic-bezier(.2,.7,.2,1),opacity 300ms}
  #tvui .mini.hide{transform:translate(-50%,150px);opacity:0}
  #tvui .mini .b{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.9);transition:all 180ms}
  #tvui .mini .b svg{width:26px;height:26px}
  #tvui .mini .b.small svg{width:20px;height:20px}
  #tvui .mini .b.small{color:rgba(255,255,255,.55)}
  #tvui .mini .lcd{position:relative;width:420px;height:58px;margin:0 10px;border-radius:12px;background:rgba(255,255,255,.07);
    display:flex;align-items:center;gap:12px;padding:0 12px 0 6px;overflow:hidden;transition:all 180ms}
  #tvui .mini .lcd .a{width:46px;height:46px;border-radius:6px;background:#333 center/cover;flex:0 0 46px}
  #tvui .mini .lcd .tx{min-width:0;flex:1;text-align:center}
  #tvui .mini .lcd .t{font-size:18px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #tvui .mini .lcd .s{font-size:15px;color:rgba(255,255,255,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #tvui .mini .lcd .pg{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.1)}
  #tvui .mini .lcd .pg i{display:block;height:3px;background:rgba(255,255,255,.55)}
  #tvui .mini .focus{background:rgba(255,255,255,.92) !important;color:#111 !important}
  #tvui .mini .lcd.focus .s{color:rgba(17,17,17,.55)}
  #tvui .sbox{position:absolute;left:50%;top:150px;width:1000px;margin-left:-500px;height:84px;border-radius:20px;background:rgba(255,255,255,.1);
    display:flex;align-items:center;gap:18px;padding:0 30px;font-size:30px;color:rgba(255,255,255,.5);transition:all 200ms}
  #tvui .sbox.focus{background:#fff;color:#111;transform:scale(1.03)}
  #tvui .sbox svg{width:30px;height:30px}
  #tvui .sbox input{position:absolute;opacity:0;pointer-events:none;width:1px}
  #tvui .shint{position:absolute;left:0;right:0;top:256px;text-align:center;font-size:20px;color:rgba(255,255,255,.45)}
  #tvui .empty{position:absolute;left:0;right:0;top:46%;text-align:center;font-size:26px;color:rgba(255,255,255,.5)}

  #tvui .eq{display:inline-flex;gap:3px;align-items:flex-end;height:20px}
  #tvui .eq i{width:4px;background:currentColor;border-radius:1px;animation:tvq 900ms ease-in-out infinite}
  #tvui .eq i:nth-child(2){animation-delay:-300ms}#tvui .eq i:nth-child(3){animation-delay:-600ms}
  #tvui .eq.paused i{animation:none;height:6px}
  @keyframes tvq{0%,100%{height:6px}50%{height:20px}}
  `;

  const ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3.5c4 0 6 10 10 10H21M17.5 13.5L21 17l-3.5 3.5M3 17h3.5c1.6 0 2.8-1.6 3.8-3.6M13.7 10.6C14.7 8.6 15.9 7 17.5 7H21M17.5 3.5L21 7l-3.5 3.5"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 6v12L2.5 12zM21 6v12l-8.5-6z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 6v12l8.5-6zM3 6v12l8.5-6z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2.5L20.5 6 17 9.5"/><path d="M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5"/><path d="M7 21.5L3.5 18 7 14.5"/><path d="M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    album: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/></svg>',
    artist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18.5" cy="12" r="2"/></svg>',
    lyrics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-5 4.5V16h0.5A2.5 2.5 0 0 1 4 13.5z"/><path d="M8.5 8.5v2M11.5 8.5v2" stroke-linecap="round"/></svg>',
    queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".6" fill="currentColor"/><circle cx="4" cy="12" r=".6" fill="currentColor"/><circle cx="4" cy="18" r=".6" fill="currentColor"/></svg>',
    volume: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/></svg>',
    volumeHi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>',
  };

  const mk = () => window.MusicKit && MusicKit.getInstance();
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const txt = (tag, cls, t) => { const e = el(tag, cls); e.textContent = t == null ? '' : t; return e; };
  const artUrl = (a, size) => a && a.url ? a.url.replace('{w}', size).replace('{h}', size).replace('{f}', 'jpg') : '';
  const fmt = s => !isFinite(s) || s < 0 ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  // Chinese titles for Apple's own rows.
  const api = async (path, q) => (await mk().api.music(path, Object.assign({ l: 'zh-Hans-CN' }, q || {}))).data;

  const root = el('div'); root.id = 'tvui';
  const style = el('style'); style.textContent = css;
  const bg = el('div', 'bg'), shade = el('div', 'shade');
  const content = el('div', 'page');
  const tabsWrap = el('div', 'tabs'), tabbar = el('div', 'tabbar');
  tabsWrap.append(tabbar);
  const mini = el('div', 'mini hide');
  const mShuf = el('div', 'b small', ICON.shuffle), mPrev = el('div', 'b', ICON.prev), mPlay = el('div', 'b'), mNext = el('div', 'b', ICON.next), mRep = el('div', 'b small', ICON.repeat);
  const lcd = el('div', 'lcd'), miniArt = el('div', 'a'), miniTx = el('div', 'tx'), miniT = txt('div', 't'), miniS = txt('div', 's'), miniPg = el('div', 'pg'), miniFill = el('i');
  miniTx.append(miniT, miniS); miniPg.append(miniFill); lcd.append(miniArt, miniTx, miniPg);
  const mLyr = el('div', 'b small', ICON.lyrics), mQueue = el('div', 'b small', ICON.queue);
  const miniParts = [mShuf, mPrev, mPlay, mNext, mRep, lcd, mLyr, mQueue];
  mini.append(...miniParts);
  const toastEl = el('div', 'toast');
  root.append(style, bg, shade, content, tabsWrap, mini, toastEl);
  let toastTimer = 0;
  function toast(t) {
    toastEl.textContent = t;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2200);
  }

  // The backdrop: the focused cover, blurred, fading in once loaded.
  let bgUrl = '';
  function setBackdrop(artwork) {
    const u = artUrl(artwork, 300);
    if (u === bgUrl) return;
    bgUrl = u;
    bg.classList.remove('on');
    if (!u) return;
    const img = new Image();
    img.onload = () => { if (bgUrl === u) { bg.style.backgroundImage = `url("${u}")`; bg.classList.add('on'); } };
    img.src = u;
  }

  function item(d) {
    const a = d.attributes || {};
    return {
      id: d.id, type: d.type, href: d.href, name: a.name || a.title || '',
      sub: a.artistName || a.curatorName || '', artwork: a.artwork, url: a.url,
      meta: [a.genreNames && a.genreNames[0], a.releaseDate && a.releaseDate.slice(0, 4)].filter(Boolean).join(' · '),
    };
  }

  // ---------- shelves: a vertical list of horizontal rows, the first one larger ----------
  function shelvesView(rows, opts) {
    opts = opts || {};
    let r = 0;
    const cols = rows.map(() => 0);
    const page = el('div', 'page'), scroll = el('div', 'scroll');
    page.append(scroll);
    let y = 0;
    const meta = rows.map((row, i) => {
      const size = i === 0 && opts.bigFirst ? 380 : 270, gap = 44;
      const s = el('div', 'shelf'), track = el('div', 'track');
      s.append(txt('h2', '', row.title), track);
      row.items.forEach(it => {
        const c = el('div', 'card'), a = el('div', 'art'), cap = el('div', 'cap');
        c.style.width = size + 'px';
        a.style.width = a.style.height = size + 'px';
        if (it.type && it.type.includes('artist')) a.style.borderRadius = '50%';
        a.style.backgroundImage = `url("${artUrl(it.artwork, size * 2)}")`;
        cap.append(txt('div', 'c1', it.name), txt('div', 'c2', it.sub));
        c.append(a, cap);
        track.append(c);
      });
      const h = 58 + size + 110;
      s.style.height = h + 'px';
      scroll.append(s);
      const top = y;
      y += h;
      return { track, size, gap, top };
    });
    function paint(focused) {
      meta.forEach((m, i) => {
        [...m.track.children].forEach((c, j) => c.classList.toggle('focus', focused && i === r && j === cols[i]));
        const visible = Math.floor((1920 - 150) / (m.size + m.gap));
        m.track.style.transform = `translateX(${-Math.max(0, cols[i] - visible + 2) * (m.size + m.gap)}px)`;
      });
      // The first row sits under the tab bar; further rows scroll up to near the top as the bar slides away.
      scroll.style.transform = `translateY(${r === 0 ? 0 : -(meta[r].top - (opts.top == null ? -60 : opts.top))}px)`;
      if (opts.tabs !== false) tabsWrap.classList.toggle('away', focused && r > 0);
      const it = rows[r] && rows[r].items[cols[r]];
      if (focused && it) setBackdrop(it.artwork);
    }
    return {
      el: page, paint, empty: !rows.length,
      key(k) {
        if (!rows.length) return k === 'ArrowUp' ? 'up' : undefined;
        const n = rows[r].items.length;
        if (k === 'ArrowRight') cols[r] = Math.min(n - 1, cols[r] + 1);
        else if (k === 'ArrowLeft') cols[r] = Math.max(0, cols[r] - 1);
        else if (k === 'ArrowDown') { if (r === rows.length - 1) return 'down'; r++; }
        else if (k === 'ArrowUp') { if (r === 0) return 'up'; r--; }
        else if (k === 'Enter') open(rows[r].items[cols[r]]);
        paint(true);
      },
    };
  }

  // ---------- library: kinds on the left, a grid on the right ----------
  const KINDS = [
    { name: '最近添加', path: '/v1/me/library/recently-added', q: { limit: 25 } },
    { name: '歌单', path: '/v1/me/library/playlists', q: { limit: 100 } },
    { name: '专辑', path: '/v1/me/library/albums', q: { limit: 100 } },
    { name: '艺人', path: '/v1/me/library/artists', q: { limit: 100, include: 'catalog' } },
    { name: '歌曲', path: '/v1/me/library/songs', q: { limit: 100 } },
  ];
  function libraryView() {
    let k = 0, inGrid = false, g = 0, items = [], focusedNow = false;
    const page = el('div', 'page'), side = el('div', 'side'), grid = el('div', 'grid'), inner = el('div', 'in');
    grid.append(inner);
    page.append(side, grid);
    const sideItems = KINDS.map(kind => { const e = txt('div', 'it', kind.name); side.append(e); return e; });
    const cache = {};
    async function load() {
      const want = k;
      if (!cache[want]) {
        try {
          cache[want] = (await api(KINDS[want].path, KINDS[want].q)).data.map(d => {
            const it = item(d);
            // Library artists have no artwork of their own; their catalog twin does.
            const cat = d.relationships && d.relationships.catalog && d.relationships.catalog.data && d.relationships.catalog.data[0];
            if (!it.artwork && cat) it.artwork = cat.attributes && cat.attributes.artwork;
            if (cat) it.catalogId = cat.id;
            return it;
          });
        } catch (e) { cache[want] = []; }
      }
      if (want !== k) return;
      items = cache[want];
      g = Math.min(g, Math.max(0, items.length - 1));
      inner.innerHTML = '';
      items.forEach(it => {
        const c = el('div', 'card'), a = el('div', 'art'), cap = el('div', 'cap');
        a.style.width = a.style.height = '236px';
        if (it.type === 'library-artists') a.style.borderRadius = '50%';
        a.style.backgroundImage = `url("${artUrl(it.artwork, 472)}")`;
        cap.append(txt('div', 'c1', it.name), txt('div', 'c2', it.sub));
        c.append(a, cap);
        inner.append(c);
      });
      if (!items.length) inner.append(txt('div', 'c2', '这里还没有内容'));
      paint(focusedNow);
    }
    function paint(focused) {
      focusedNow = focused;
      sideItems.forEach((e, i) => { e.classList.toggle('on', i === k); e.classList.toggle('focus', focused && !inGrid && i === k); });
      [...inner.children].forEach((c, i) => c.classList.toggle('focus', focused && inGrid && i === g));
      const row = Math.floor(g / 5);
      inner.style.transform = `translateY(${-Math.max(0, row - 1) * (236 + 56 + 66)}px)`;
      tabsWrap.classList.toggle('away', focused && inGrid && row > 0);
      if (focused && inGrid && items[g]) setBackdrop(items[g].artwork);
    }
    return {
      el: page, paint, start: load,
      key(key) {
        if (!inGrid) {
          if (key === 'ArrowDown') { if (k < KINDS.length - 1) { k++; g = 0; paint(true); load(); } return; }
          if (key === 'ArrowUp') { if (k === 0) return 'up'; k--; g = 0; paint(true); load(); return; }
          if ((key === 'ArrowRight' || key === 'Enter') && items.length) { inGrid = true; paint(true); }
          return;
        }
        if (key === 'ArrowRight') g = Math.min(items.length - 1, g + 1);
        else if (key === 'ArrowLeft') { if (g % 5 === 0) inGrid = false; else g--; }
        else if (key === 'ArrowDown') { if (g + 5 < items.length) g += 5; else return 'down'; }
        else if (key === 'ArrowUp') { if (g < 5) return 'up'; g -= 5; }
        else if (key === 'Enter') open(items[g]);
        paint(true);
      },
    };
  }

  // ---------- album / playlist ----------
  function albumView(it, tracks) {
    let f = 0; // 0 play, 1 shuffle, then the tracks
    const page = el('div', 'album'), left = el('div', 'left'), cover = el('div', 'cover');
    cover.style.backgroundImage = `url("${artUrl(it.artwork, 1040)}")`;
    const btns = el('div', 'btns'), bPlay = el('div', 'btn', ICON.play + '播放'), bShuf = el('div', 'btn', ICON.shuffle + '随机播放');
    btns.append(bPlay, bShuf);
    left.append(cover, txt('h1', '', it.name), txt('div', 'by', it.sub), txt('div', 'meta', it.meta), btns);
    const list = el('div', 'tracks'), inner = el('div', 'in');
    list.append(inner);
    const isPlaylist = it.type.includes('playlist');
    tracks.forEach((t, i) => {
      const a = t.attributes || {};
      const row = el('div', 'tr'), nm = txt('div', 'nm', a.name);
      if (isPlaylist) nm.append(txt('span', 'ar', a.artistName));
      row.append(txt('span', 'n', String(i + 1)), nm, txt('span', 'd', fmt((a.durationInMillis || 0) / 1000)));
      row.dataset.id = t.id;
      row.dataset.name = a.name || '';
      inner.append(row);
    });
    page.append(left, list);
    let pending = -1;  // the row just chosen, until Apple's player starts it
    function paint(focused) {
      bPlay.classList.toggle('focus', focused && f === 0);
      bShuf.classList.toggle('focus', focused && f === 1);
      const now = mk().nowPlayingItem, nowName = now && now.attributes && now.attributes.name;
      if (pending >= 0 && nowName && inner.children[pending] && inner.children[pending].dataset.name === nowName && mk().isPlaying) pending = -1;
      [...inner.children].forEach((row, i) => {
        row.classList.toggle('focus', focused && f === i + 2);
        row.classList.toggle('loading', i === pending);
        row.classList.toggle('playing', i !== pending && !!nowName && (now.id === row.dataset.id || row.dataset.name === nowName));
      });
      inner.style.transform = `translateY(${-Math.max(0, f - 2 - 5) * 76}px)`;
      tabsWrap.classList.add('away');
    }
    setBackdrop(it.artwork);
    return {
      el: page, paint, live: true,
      key(k) {
        if (k === 'ArrowRight') f = f === 0 ? 1 : f === 1 ? 2 : f;
        else if (k === 'ArrowLeft') f = f === 1 ? 0 : f >= 2 ? 0 : f;
        else if (k === 'ArrowDown') { if (f >= tracks.length + 1) return 'down'; f = f < 2 ? 2 : f + 1; }
        else if (k === 'ArrowUp') f = f <= 2 ? 0 : f - 1;
        else if (k === 'Enter') {
          mk().shuffleMode = f === 1 ? 1 : 0;
          pending = f >= 2 ? f - 2 : (f === 0 ? 0 : -1);
          playContainer(it, f >= 2 ? f - 2 : 0);
        }
        paint(true);
      },
    };
  }

  // ---------- now playing ----------
  // Localised names: our own requests ask for Chinese, but the player's queue items come from MusicKit's
  // fetches in English, where Apple names many Chinese songs in pinyin. So the songs in the queue are asked
  // for again in Chinese, a few at a time, and kept; until they arrive the player's own names show.
  const localName = {};
  let wantNames = new Set(), namesTimer = 0;
  const catId = n => { const a = n && n.attributes || {}; return a.playParams && (a.playParams.catalogId || a.playParams.id) || n && n.id; };
  function localise(id) {
    if (!id || localName[id] !== undefined || !/^\d+$/.test(id)) return;
    localName[id] = null;
    wantNames.add(id);
    clearTimeout(namesTimer);
    namesTimer = setTimeout(async () => {
      const ids = [...wantNames].slice(0, 100);
      ids.forEach(i => wantNames.delete(i));
      try {
        (await api('/v1/catalog/{{storefrontId}}/songs', { ids: ids.join(',') })).data.forEach(d => {
          const a = d.attributes || {};
          localName[d.id] = { name: a.name, artist: a.artistName, album: a.albumName };
        });
      } catch (e) {}
    }, 30);
  }
  function nameOf(n) {
    const a = n && n.attributes || {}, id = catId(n), l = localName[id];
    if (l === undefined && n) localise(id);
    return { name: l && l.name || a.name || '', artist: l && l.artist || a.artistName || '', album: l && l.album || a.albumName || '' };
  }
  // The next few in the queue too, so the list on the right and the next title are Chinese from the start.
  function localiseQueue() {
    const m = mk();
    if (m && m.queue && m.queue.items) m.queue.items.slice(m.queue.position, m.queue.position + 9).forEach(q => localise(catId(q)));
  }

  // Favourite (the star; Apple's rating of 1) and library state of the song now playing, asked once per song.
  const songState = {};
  async function stateOf(id) {
    if (!id) return {};
    if (songState[id]) return songState[id];
    const st = songState[id] = { fav: false, inLib: false, album: null, artist: null };
    try {
      const r = await mk().api.music(`/v1/me/ratings/songs/${id}`);
      st.fav = !!(r.data && r.data.data && r.data.data[0] && r.data.data[0].attributes.value === 1);
    } catch (e) {}
    try {
      const d = (await api(`/v1/catalog/{{storefrontId}}/songs/${id}`, { include: 'albums,artists', relate: 'library' })).data[0];
      const rel = d.relationships || {};
      st.inLib = !!(rel.library && rel.library.data && rel.library.data.length);
      st.album = rel.albums && rel.albums.data && rel.albums.data[0] && item(rel.albums.data[0]);
      st.artist = rel.artists && rel.artists.data && rel.artists.data[0] && item(rel.artists.data[0]);
    } catch (e) {}
    return st;
  }
  async function setFavourite(id, on) {
    const st = await stateOf(id);
    try {
      if (on) await mk().api.music(`/v1/me/ratings/songs/${id}`, {}, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'rating', attributes: { value: 1 } }) });
      else await mk().api.music(`/v1/me/ratings/songs/${id}`, {}, { method: 'DELETE' });
      st.fav = on;
      toast(on ? '已添加到喜爱' : '已从喜爱中移除');
    } catch (e) { console.warn('tvui rating', e); toast('操作没有成功，请稍后再试'); }
  }
  async function addToLibrary(id) {
    const st = await stateOf(id);
    if (st.inLib) return toast('已在资料库中');
    try {
      await mk().api.music('/v1/me/library', { 'ids[songs]': id }, { method: 'POST' });
      st.inLib = true;
      toast('已添加到资料库');
    } catch (e) { console.warn('tvui library', e); toast('操作没有成功，请稍后再试'); }
  }

  // Timed lyrics (TTML, one <p begin end> per line), fetched once per song.
  const lyricCache = {};
  async function lyricsFor(n) {
    const a = n && n.attributes || {};
    const id = a.playParams && (a.playParams.catalogId || a.playParams.id) || n && n.id;
    if (!id) return null;
    if (lyricCache[id] !== undefined) return lyricCache[id];
    lyricCache[id] = null;
    try {
      const ttml = (await mk().api.music(`/v1/catalog/${mk().storefrontId}/songs/${id}/lyrics`)).data.data[0].attributes.ttml;
      const doc = new DOMParser().parseFromString(ttml, 'text/xml');
      const t = v => { if (!v) return 0; const p = v.split(':').map(Number); return p.reduce((acc, x) => acc * 60 + x, 0); };
      lyricCache[id] = [...doc.getElementsByTagName('p')].map(p => ({ begin: t(p.getAttribute('begin')), text: p.textContent.trim() })).filter(l => l.text);
    } catch (e) {}
    return lyricCache[id];
  }

  function nowPlayingView(side) {
    // Focus: a row (0 star and More, 1 the transport, 2 the volume) and a place in it; the More menu on top.
    let row = 1, f = 2, menu = null, mf = 0;
    const page = el('div', 'np'), wash = el('div', 'wash'), dim = el('div', 'dim'), col = el('div', 'col');
    const cover = el('div', 'cover');
    const meta = el('div', 'meta'), tx = el('div', 'tx'), h1 = txt('h1'), by = txt('div', 'by');
    tx.append(h1, by);
    const bStar = el('div', 'round', ICON.star), bMore = el('div', 'round', ICON.more);
    meta.append(tx, bStar, bMore);
    const scrub = el('div', 'scrub'), fill = el('i'), knob = el('b');
    scrub.append(fill, knob);
    const times = el('div', 'times'), t0 = txt('span'), t1 = txt('span');
    times.append(t0, t1);
    const ctl = el('div', 'ctl');
    const bShuf = el('div', 'small', ICON.shuffle), bPrev = el('div', '', ICON.prev), bPlay = el('div', 'big'), bNext = el('div', '', ICON.next), bRep = el('div', 'small', ICON.repeat);
    const buttons = [bShuf, bPrev, bPlay, bNext, bRep];
    ctl.append(...buttons);
    const vol = el('div', 'vol'), vScrub = el('div', 'scrub'), vFill = el('i'), vKnob = el('b');
    vScrub.append(vFill, vKnob);
    vol.append(el('span', '', ICON.volume), vScrub, el('span', '', ICON.volumeHi));
    col.append(cover, meta, scrub, times, ctl, vol);
    const lyr = el('div', 'lyr'), lin = el('div', 'in');
    lyr.append(lin);
    const menuEl = el('div', 'menu');
    page.append(wash, dim, col, lyr, menuEl);
    let shownFor = null, lines = null, st = {};
    function fillRight(n) {
      lin.innerHTML = '';
      lin.style.transform = '';
      lines = null;
      const showQueue = () => {
        const m = mk(), up = el('div', 'up');
        up.append(txt('h3', '', '待播清单'));
        (m.queue.items || []).slice(m.queue.position + 1, m.queue.position + 9).forEach(q => {
          const a = q.attributes || {}, row = el('div', 'q'), art = el('div', 'a'), t = el('div');
          art.style.backgroundImage = `url("${artUrl(a.artwork, 128)}")`;
          t.style.minWidth = '0';
          const nm = nameOf(q);
          t.append(txt('div', 't', nm.name), txt('div', 's', nm.artist));
          row.append(art, t);
          up.append(row);
        });
        lin.style.transform = 'translateY(200px)';
        lin.append(up);
      };
      if (side === 'queue') return showQueue();
      lyricsFor(n).then(ls => {
        if (shownFor !== n.id) return;
        if (ls && ls.length) { lines = ls; ls.forEach(l => lin.append(txt('div', 'ln', l.text))); }
        else showQueue();
      });
    }
    // The menu's rows, built when it opens (their wording follows the song's state).
    function menuItems() {
      const id = catId(mk().nowPlayingItem);
      return [
        { icon: st.inLib ? ICON.check : ICON.plus, label: st.inLib ? '已在资料库中' : '添加到资料库', off: st.inLib, run: () => addToLibrary(id) },
        { icon: ICON.album, label: '前往专辑', off: !st.album, run: () => st.album && open(st.album) },
        { icon: ICON.artist, label: '前往艺人', off: !st.artist, run: () => st.artist && open(st.artist) },
        { icon: side === 'queue' ? ICON.lyrics : ICON.queue, label: side === 'queue' ? '显示歌词' : '显示待播清单',
          run: () => { side = side === 'queue' ? 'lyrics' : 'queue'; const n = mk().nowPlayingItem; if (n) fillRight(n); } },
      ];
    }
    function paintMenu() {
      menuEl.classList.toggle('open', !!menu);
      if (!menu) return;
      menuEl.innerHTML = '';
      menu.forEach((it, i) => {
        const e = el('div', 'mi' + (it.off ? ' off' : '') + (i === mf ? ' focus' : ''), it.icon);
        e.append(txt('span', '', it.label));
        menuEl.append(e);
      });
    }
    function paint(focused) {
      const m = mk(), n = m.nowPlayingItem, a = n ? n.attributes || {} : {};
      const nm = nameOf(n);
      localiseQueue();
      h1.textContent = nm.name || '没有正在播放的歌曲';
      by.textContent = [nm.artist, nm.album].filter(Boolean).join(' — ');
      const u = artUrl(a.artwork, 1240);
      if (cover.dataset.u !== u) {
        cover.dataset.u = u;
        cover.style.backgroundImage = u ? `url("${u}")` : '';
        wash.style.backgroundImage = u ? `url("${artUrl(a.artwork, 300)}")` : '';
      }
      cover.classList.toggle('paused', !m.isPlaying);
      if (n && shownFor !== n.id) {
        shownFor = n.id;
        fillRight(n);
        st = {};
        const id = catId(n);
        stateOf(id).then(x => { if (shownFor === n.id) { st = x; paint(focused); } });
      }
      const playIcon = m.isPlaying ? ICON.pause : ICON.play;
      if (bPlay.dataset.i !== playIcon) { bPlay.dataset.i = playIcon; bPlay.innerHTML = playIcon; }
      const starIcon = st.fav ? ICON.starOn : ICON.star;
      if (bStar.dataset.i !== starIcon) { bStar.dataset.i = starIcon; bStar.innerHTML = starIcon; }
      bStar.classList.toggle('on', !!st.fav);
      bShuf.classList.toggle('on', !!m.shuffleMode);
      bRep.classList.toggle('on', !!m.repeatMode);
      const live = focused && !menu;
      bStar.classList.toggle('focus', live && row === 0 && f === 0);
      bMore.classList.toggle('focus', (live && row === 0 && f === 1) || !!menu);
      buttons.forEach((b, i) => b.classList.toggle('focus', live && row === 1 && i === f));
      vol.classList.toggle('focus', live && row === 2);
      const t = m.currentPlaybackTime || 0, d = m.currentPlaybackDuration || 0, pct = d ? 100 * t / d : 0;
      fill.style.width = pct + '%'; knob.style.left = pct + '%';
      t0.textContent = fmt(t);
      t1.textContent = '-' + fmt(d - t);
      const v = 100 * (m.volume == null ? 1 : m.volume);
      vFill.style.width = v + '%'; vKnob.style.left = v + '%';
      if (lines) {
        let cur = 0;
        lines.forEach((l, i) => { if (l.begin <= t + 0.3) cur = i; });
        [...lin.children].forEach((e, i) => e.classList.toggle('on', i === cur));
        const e = lin.children[cur];
        if (e) lin.style.transform = `translateY(${380 - e.offsetTop}px)`;
      }
    }
    return {
      el: page, paint, live: true, full: true,
      // Back closes the menu first.
      back() { if (!menu) return false; menu = null; paintMenu(); paint(true); return true; },
      key(k) {
        const m = mk();
        if (menu) {
          // Rows that can't be used are skipped, as on tvOS.
          const step = d => { for (let i = mf + d; i >= 0 && i < menu.length; i += d) if (!menu[i].off) return i; return mf; };
          if (k === 'ArrowUp') mf = step(-1);
          else if (k === 'ArrowDown') mf = step(1);
          else if (k === 'ArrowLeft' || k === 'ArrowRight') { /* stays in the menu */ }
          else if (k === 'Enter') {
            const it = menu[mf];
            if (it.off) return;
            menu = null; paintMenu();
            it.run();
          }
          paintMenu(); paint(true);
          return;
        }
        if (k === 'ArrowUp') { if (row > 0) { row--; f = row === 0 ? 0 : 2; } }
        else if (k === 'ArrowDown') { if (row < 2) { row++; f = row === 1 ? 2 : 0; } }
        else if (row === 2 && (k === 'ArrowLeft' || k === 'ArrowRight')) {
          m.volume = Math.max(0, Math.min(1, Math.round(((m.volume == null ? 1 : m.volume) + (k === 'ArrowRight' ? .05 : -.05)) * 20) / 20));
        }
        else if (k === 'ArrowLeft') f = Math.max(0, f - 1);
        else if (k === 'ArrowRight') f = Math.min(row === 0 ? 1 : 4, f + 1);
        else if (k === 'Enter') {
          const id = catId(m.nowPlayingItem);
          if (row === 0 && f === 0) { if (id) setFavourite(id, !st.fav).then(() => paint(true)); }
          else if (row === 0) { if (m.nowPlayingItem) { menu = menuItems(); mf = Math.max(0, menu.findIndex(x => !x.off)); paintMenu(); } }
          else if (row === 1) {
            if (f === 0) m.shuffleMode = m.shuffleMode ? 0 : 1;
            else if (f === 1) m.skipToPreviousItem();
            else if (f === 2) toggle();
            else if (f === 3) m.skipToNextItem();
            else m.repeatMode = (m.repeatMode + 1) % 3;
          }
        }
        paint(true);
      },
    };
  }

  // ---------- search ----------
  // Asking the TV for its own keyboard: MacTV watches this window's title and opens the TV's input method,
  // whose text comes back typed into the focused field, followed by Return.
  const baseTitle = document.title;
  function wantKeyboard(on) { document.title = on ? '⌨ ' + baseTitle : baseTitle; }

  function searchView() {
    let inBox = true, term = '', results = null;
    const page = el('div', 'page'), box = el('div', 'sbox', ICON.search), label = txt('span', '', '歌曲、歌手、专辑、歌单'), input = el('input');
    box.append(label, input);
    const hint = txt('div', 'shint', '按确认键输入');
    const holder = el('div', 'page');
    holder.style.top = '110px';
    page.append(holder, box, hint);
    input.addEventListener('input', () => { term = input.value; label.textContent = term || '歌曲、歌手、专辑、歌单'; });
    function setText(t, go) {
      input.value = t; term = t; label.textContent = t || '歌曲、歌手、专辑、歌单';
      if (go) run();
    }
    async function run() {
      wantKeyboard(false);
      if (!term.trim()) return;
      label.textContent = term + '　…';
      const rows = [];
      try {
        const r = (await api('/v1/catalog/{{storefrontId}}/search', { term, types: 'songs,albums,artists,playlists', limit: 20 })).results || {};
        if (r.songs) rows.push({ title: '歌曲', items: r.songs.data.map(item) });
        if (r.albums) rows.push({ title: '专辑', items: r.albums.data.map(item) });
        if (r.artists) rows.push({ title: '艺人', items: r.artists.data.map(item) });
        if (r.playlists) rows.push({ title: '歌单', items: r.playlists.data.map(item) });
      } catch (e) {}
      label.textContent = term;
      results = shelvesView(rows, { top: 0, tabs: false });
      holder.innerHTML = '';
      holder.append(results.el);
      hint.style.display = 'none';
      inBox = !rows.length;
      paint(true);
    }
    function paint(focused) {
      box.classList.toggle('focus', focused && inBox);
      box.style.visibility = !inBox && results ? 'hidden' : 'visible';
      if (results) results.paint(focused && !inBox);
      if (focused && inBox) setTimeout(() => input.focus(), 0); else input.blur();
      tabsWrap.classList.toggle('away', focused && !inBox);
    }
    return {
      el: page, paint, setText, typing: () => inBox,
      key(k) {
        if (inBox) {
          if (k === 'Enter') {
            if (term.trim() && document.title.startsWith('⌨')) return void run();
            input.value = ''; term = ''; label.textContent = '歌曲、歌手、专辑、歌单';
            input.focus();
            wantKeyboard(true);  // the TV opens its keyboard; its text arrives here, then Return runs the search
            setTimeout(() => wantKeyboard(false), 60000);
            return;
          }
          if (k === 'ArrowDown' && results && !results.empty) { inBox = false; paint(true); return; }
          if (k === 'ArrowUp') return 'up';
          return;
        }
        if (results.key(k) === 'up') { inBox = true; paint(true); }
      },
    };
  }

  // ---------- data ----------
  async function homeRows() {
    const rows = [];
    try {
      const recs = await api('/v1/me/recommendations', { limit: 10 });
      for (const rec of recs.data) {
        const items = (rec.relationships && rec.relationships.contents && rec.relationships.contents.data || []).map(item);
        const title = rec.attributes && rec.attributes.title && rec.attributes.title.stringForDisplay;
        if (items.length && title && !rows.some(x => x.title === title)) rows.push({ title, items });
      }
    } catch (e) {}
    try {
      const recent = await api('/v1/me/recent/played', { limit: 20 });
      if (recent.data.length && !rows.some(x => x.title === '最近播放')) rows.splice(Math.min(1, rows.length), 0, { title: '最近播放', items: recent.data.map(item) });
    } catch (e) {}
    try {
      const heavy = await api('/v1/me/history/heavy-rotation', { limit: 20 });
      if (heavy.data.length) rows.push({ title: '常听', items: heavy.data.map(item) });
    } catch (e) {}
    return rows;
  }
  async function browseRows() {
    const rows = [];
    try {
      const c = (await api('/v1/catalog/{{storefrontId}}/charts', { types: 'albums,playlists,songs', limit: 20 })).results || {};
      if (c.playlists && c.playlists[0]) rows.push({ title: c.playlists[0].name || '热门歌单', items: c.playlists[0].data.map(item) });
      if (c.albums && c.albums[0]) rows.push({ title: c.albums[0].name || '热门专辑', items: c.albums[0].data.map(item) });
      if (c.songs && c.songs[0]) rows.push({ title: c.songs[0].name || '热门歌曲', items: c.songs[0].data.map(item) });
    } catch (e) {}
    return rows;
  }

  async function playContainer(it, start) {
    const m = mk();
    m.previewOnly = false; // the web player sometimes stays on 30-second previews though the account subscribes
    const kind = it.type.replace('library-', '').replace(/s$/, '');
    try {
      if (kind === 'album' || kind === 'playlist') await m.setQueue({ [kind]: it.id, startWith: start || 0, startPlaying: true });
      else if (kind === 'station') await m.setQueue({ station: it.id, startPlaying: true });
      else if (kind === 'song') await m.setQueue({ song: it.id, startPlaying: true });
      else if (it.url) await m.setQueue({ url: it.url, startPlaying: true });
      await m.play();
    } catch (e) { console.warn('tvui play', e); }
  }

  async function open(it) {
    if (!it) return;
    const kind = it.type.replace('library-', '');
    if (kind === 'albums' || kind === 'playlists') {
      let tracks = [];
      try {
        const d = await api(it.href || `/v1/catalog/{{storefrontId}}/${it.type}/${it.id}`, { include: 'tracks' });
        const x = d.data[0], rel = x.relationships && x.relationships.tracks;
        tracks = rel && rel.data || [];
        if (rel && rel.next) tracks = tracks.concat((await api(rel.next, { limit: 100 })).data);
        const full = item(x);
        it = Object.assign({}, it, { meta: full.meta || it.meta, sub: full.sub || it.sub, artwork: it.artwork || full.artwork });
      } catch (e) { console.warn('tvui tracks', e); }
      push(albumView(it, tracks));
    } else if (kind === 'artists') {
      try {
        const id = it.catalogId || it.id;
        const d = await api(`/v1/catalog/{{storefrontId}}/artists/${id}`, { include: 'albums' });
        const albums = (d.data[0].relationships.albums.data || []).map(item);
        push(shelvesView([{ title: it.name, items: albums }], { top: 0, tabs: false }));
      } catch (e) {}
    } else {
      await playContainer(it, 0);
    }
  }

  // ---------- tabs and the view stack ----------
  const TABS = [
    { name: '主页', make: async () => shelvesView(await homeRows(), { bigFirst: true }) },
    { name: '新发现', make: async () => shelvesView(await browseRows(), { bigFirst: true }) },
    { name: '资料库', make: async () => libraryView() },
    { name: 'search', make: async () => searchView() },
  ];
  const state = { tab: 0, inTabs: false, inMini: false, mf: 0, stack: [], view: null, views: {} };

  function paintMini() {
    const m = mk(), n = m && m.nowPlayingItem;
    const show = !!n && !(state.view && state.view.full);
    mini.classList.toggle('hide', !show);
    if (!show) { if (state.inMini) leaveMini(); return; }
    const a = n.attributes || {}, nm = nameOf(n);
    miniT.textContent = nm.name;
    miniS.textContent = [nm.artist, nm.album].filter(Boolean).join(' — ');
    const u = artUrl(a.artwork, 128);
    if (miniArt.dataset.u !== u) { miniArt.dataset.u = u; miniArt.style.backgroundImage = `url("${u}")`; }
    const playIcon = m.isPlaying ? ICON.pause : ICON.play;
    if (mPlay.dataset.i !== playIcon) { mPlay.dataset.i = playIcon; mPlay.innerHTML = playIcon; }
    mShuf.style.color = m.shuffleMode ? '#fff' : '';
    mRep.style.color = m.repeatMode ? '#fff' : '';
    miniParts.forEach((b, i) => b.classList.toggle('focus', state.inMini && i === state.mf));
    miniFill.style.width = (m.currentPlaybackDuration ? 100 * m.currentPlaybackTime / m.currentPlaybackDuration : 0) + '%';
  }
  function enterMini() { state.inMini = true; state.mf = 5; state.view.paint(false); paintMini(); }
  function leaveMini() { state.inMini = false; paintMini(); if (state.view) state.view.paint(!state.inTabs); }
  const nowMark = el('span', 'eq', '<i></i><i></i><i></i>');

  function tabCount() { return TABS.length; }
  function drawTabs() {
    tabbar.innerHTML = '';
    for (let i = 0; i < tabCount(); i++) {
      const e = el('div', 'tab' + (i === state.tab && !state.stack.length ? ' on' : '') + (state.inTabs && i === state.tab ? ' focus' : ''));
      if (TABS[i].name === 'search') e.innerHTML = ICON.search;
      else e.textContent = TABS[i].name;
      tabbar.append(e);
    }
  }

  function mount(v) {
    content.innerHTML = '';
    content.append(v.el);
    state.inMini = false;
    if (v.full) tabsWrap.classList.add('away');
    v.paint(!state.inTabs);
    paintMini();
    if (v.empty) content.append(txt('div', 'empty', '这里还没有内容'));
  }
  async function showTab(i, inTabs) {
    state.tab = i; state.stack = []; state.inTabs = !!inTabs;
    tabsWrap.classList.remove('away');
    drawTabs();
    if (!state.views[i]) {
      content.innerHTML = '';
      content.append(txt('div', 'empty', '正在载入…'));
      state.views[i] = await TABS[i].make();
      if (state.views[i].start) state.views[i].start();
    }
    if (state.tab !== i) return;
    state.view = state.views[i];
    mount(state.view);
  }
  function push(v) { state.stack.push(state.view); state.view = v; state.inTabs = false; mount(v); drawTabs(); }
  function showNowPlaying(side) { push(nowPlayingView(side)); }
  function back() {
    if (state.view && state.view.back && state.view.back()) return;
    if (state.stack.length) { state.view = state.stack.pop(); mount(state.view); drawTabs(); return; }
    if (!state.inTabs) { state.inTabs = true; drawTabs(); tabsWrap.classList.remove('away'); state.view.paint(false); return; }
    if (state.tab !== 0) showTab(0, true);
  }
  function toggle() { const m = mk(); m.isPlaying ? m.pause() : m.play(); }

  // From the TV home screen: play an album or playlist and open the full player. Returns 'ok' once started.
  window.__tvuiPlay = async (kind, id, shuffle) => {
    if (!state.view) return 'wait';
    const m = mk();
    m.shuffleMode = shuffle ? 1 : 0;
    await playContainer({ type: kind, id }, 0);
    showNowPlaying();
    return 'ok';
  };

  // Text from the TV's keyboard, handed over by MacTV through DevTools (keystrokes can't carry Chinese).
  window.__tvuiText = async (t, go) => {
    if (state.tab !== 3 || state.stack.length) await showTab(3, false);
    state.views[3].setText(t, go);
  };

  document.addEventListener('keydown', e => {
    if (!document.getElementById('tvui')) return;
    const k = e.key;
    // Typing into search: characters and Backspace go to the hidden field.
    if (!state.inTabs && state.view && state.view.typing && state.view.typing() && (k.length === 1 && k !== ' ' || k === 'Backspace')) return;
    e.preventDefault(); e.stopPropagation();
    if (k === ' ') return toggle();
    if (k === 'n') return mk().skipToNextItem();
    if (k === 'p') return mk().skipToPreviousItem();
    if (state.inMini) {
      const m = mk();
      if (k === 'ArrowLeft') state.mf = Math.max(0, state.mf - 1);
      else if (k === 'ArrowRight') state.mf = Math.min(miniParts.length - 1, state.mf + 1);
      else if (k === 'ArrowUp' || k === 'Escape' || k === 'Backspace') return leaveMini();
      else if (k === 'Enter') {
        switch (state.mf) {
          case 0: m.shuffleMode = m.shuffleMode ? 0 : 1; break;
          case 1: m.skipToPreviousItem(); break;
          case 2: toggle(); break;
          case 3: m.skipToNextItem(); break;
          case 4: m.repeatMode = (m.repeatMode + 1) % 3; break;
          default: leaveMini(); return showNowPlaying(state.mf === 7 ? 'queue' : 'lyrics');
        }
      }
      return paintMini();
    }
    if (k === 'Escape' || k === 'Backspace') return back();
    if (state.inTabs) {
      if (k === 'ArrowLeft' && state.tab > 0) showTab(state.tab - 1, true);
      else if (k === 'ArrowRight' && state.tab < tabCount() - 1) showTab(state.tab + 1, true);
      else if (k === 'ArrowDown' || k === 'Enter') { state.inTabs = false; drawTabs(); state.view.paint(true); }
      return;
    }
    const r = state.view && state.view.key(k);
    if (r === 'up' && !state.stack.length) { state.inTabs = true; drawTabs(); tabsWrap.classList.remove('away'); state.view.paint(false); }
    else if (r === 'down' && !mini.classList.contains('hide')) enterMini();
  }, true);

  setInterval(() => {
    const m = mk(); if (!m) return;
    if (state.view && state.view.live) state.view.paint(!state.inTabs && !state.inMini);
    paintMini();
  }, 1000);

  async function start() {
    if (!mk() || !document.body) return setTimeout(start, 500);
    mk().previewOnly = false;
    // Play and browse in the account's own storefront: the page picks one from the network's location, and
    // library songs from another storefront then fail to queue ("CONTENT_EQUIVALENT").
    try { mk().storefrontId = (await api('/v1/me/storefront')).data[0].id; } catch (e) {}
    document.body.append(root);
    showTab(0, false);
  }
  start();
})();
