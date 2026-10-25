# site

The MacTV web page: one self-contained HTML file, `public/index.html`, built from the sources here.

| Path | What |
|---|---|
| `src/build.mjs` | draws Fig. 1 (the study and the living room) as an isometric SVG, and the screen-space routes the page animates |
| `src/page.src.html` | the page: layout, text in Chinese and English, scroll behaviour |
| `src/materials.css` | colours of the rooms, furniture and screens |
| `src/assemble.mjs` | puts the page, the CSS and the figure together into `public/index.html` |
| `vendor/anatomy/` | the drawing kit used by `build.mjs`, from [Anatomy](https://github.com/wheresryan22/anatomy) (MIT, see its `LICENSE`) |

## Build

Node.js 20 or later, no packages to install:

```bash
node site/src/build.mjs
node site/src/assemble.mjs
open site/public/index.html
```

## Deploy (Cloudflare Pages)

`public/` is the whole site; `wrangler.jsonc` at the repository root points Cloudflare Pages at it. With a
Cloudflare account:

```bash
npx wrangler login                                                  # once, opens a browser
npx wrangler pages project create mactv --production-branch main    # once
npx wrangler pages deploy                                           # every time the page changes
```

The page is served at `https://<project>.pages.dev` (Cloudflare adds a short suffix when the name is taken).
Connecting the GitHub repository in the Cloudflare dashboard instead (build command: none, output directory:
`site/public`) redeploys on every push. `*.pages.dev` is used rather than `*.workers.dev`, which some networks
cannot reach.
