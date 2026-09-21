# «خوص» — final cover asset set

Generated 2026-09-18. All assets share one cover design: saffron-ochre bookcloth,
deep coffee-brown debossed ink, centred type, and a small engraved overhead
palm-frond tray motif. Arabic binding throughout — the spine sits on the
right-hand edge of the front cover.

Cover strings, verbatim:

- Title: خوص
- Subtitle: حكايات شارع 4 (Western numeral 4)
- Author: أنس عبدالله القرني

## Files

| File | Size | Use |
|---|---|---|
| `khous-transparent.png` | 1744×2336, RGBA | Site. Alpha verified clean against both `--paper` #F4ECE0 and `--forest` #234A30 — no edge fringing. Drops onto any section background, including the green editions block. |
| `khous-white-retail.png` | 2480×3312, RGB | Retail and press listings (Jarir, نيل وفرات, media kits). Pure white, single soft contact shadow. |
| `khous-og-1200x630.png` | 1200×630, RGB | Open Graph / social share card. Book on the left third, the right two thirds left deliberately clear for a headline overlay. |
| `khous-flat-cover-comp.png` | 2560×3200, RGB | **Approval comp only — NOT a print file.** Flat front-cover face, no perspective, no mockup staging. |

## The print file is still outstanding

`khous-flat-cover-comp.png` is a raster visual comp. A production cover file
still needs to be built by a designer: live vector type set in the licensed
Lyon Arabic Display, CMYK separations, 3mm bleed, crop marks, the real trim
size, and a spine width calculated from the final page count and paper bulk.
Sending this comp to a press would produce soft type and unreliable colour.

## Open decisions

- Trim size is assumed at roughly 24×30cm; confirm with Anas before any print quote.
- The saffron cloth colour sits outside the current site token set (nearest is
  `--brass` #B28E5A). Either add saffron as a token or retune the cloth.
- The engraved tray motif should be drawn once properly and reused across cover,
  spine, title page and section breaks rather than regenerated per asset.
- Edition pricing (90 SAR print / 150 SAR signed, PRD grill N2) predates this
  format. A large cloth hardcover plus a hand-woven bookmark costs more to
  produce than the current print tier charges.
