# UI media

## Fonts

The HUD uses two pixel faces, served from this folder so the game never asks a third-party font host
for them:

| File | Family | Weights | Used for | Licence |
| --- | --- | --- | --- | --- |
| `fonts/silkscreen-regular.woff2`, `fonts/silkscreen-bold.woff2` | Silkscreen | 400, 700 | Numbers, key hints, and short labels | `fonts/OFL-Silkscreen.txt` |
| `fonts/pixelify-sans.woff2` | Pixelify Sans (variable) | 400-700 | Names, headings, and sentences | `fonts/OFL-PixelifySans.txt` |

Both are licensed under the SIL Open Font License 1.1 and declare no Reserved Font Name. Each font
also carries its copyright and licence in its `name` table, so the copies Vite emits into the build
keep them.

They are the upstream TTFs from [google/fonts](https://github.com/google/fonts) (`ofl/silkscreen`
and `ofl/pixelifysans`, commit `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`), converted to WOFF2
with fontTools and otherwise unchanged: no subsetting or glyph edits. To update one, convert the new
TTF the same way:

```sh
python3 -m pip install fonttools brotli
python3 -c "from fontTools.ttLib import TTFont; f = TTFont('Silkscreen-Regular.ttf'); f.flavor = 'woff2'; f.save('silkscreen-regular.woff2')"
```

`src/client/styles.css` declares them with `@font-face` and `font-display: swap`, so HUD text shows
in a fallback face until they arrive.
