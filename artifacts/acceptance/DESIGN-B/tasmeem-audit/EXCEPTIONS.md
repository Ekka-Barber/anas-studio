# tasmeem audit · brand grants for DESIGN-B

Passed to every `tasmeem report` with `--design`. Each line below names a tell that the project documents as a deliberate choice, with the decision or the `DESIGN.md` line that grants it.

## Brand exceptions

- CO-03: the sand ground is Anas's own palette (D39). DESIGN.md §1: "Anas's palette board (sand, coral, aubergine)"; `--sand` #E0C6AD "The page".
- CO-13: the woven band is a brand pattern (D39). DESIGN.md §4: "`<Edge kind="weave">`: the 28px palm-weave strip in all four colours (`public/brand/weave.svg`)."
- TY-02: Thmanyah Serif and Sans are the only fonts (D33). DESIGN.md §2: "Thmanyah only (D33): Serif Display (400, 500) for everything set large, Sans (400, 500, 700) for reading and every control."
- TY-08: poster-sized display type is the design. DESIGN.md §2: "The large sizes are the design; B sets titles and bands at poster size on purpose."
- CO-12: the crenel triangles are drawn with a hard-edged `conic-gradient`; they are the brand's Najdi triangle, not a decorative gradient. DESIGN.md §4: "`<Edge kind="crenel" color>`: a row of triangles in the colour of the band that follows, standing on it like the Najdi triangles on Anas's ذرى card."
- TY-04: the two-tone headline of the 404 and the error page (added 2026-09-28, FINDINGS row 17). DESIGN.md §2: "The 404 and the error page set their headline in two parts, the second in coral on aubergine (`.t-accent`) … It belongs to these two pages only; every other headline is one colour."

## Limits

These grants never cover accessibility (the QA family), writing-system correctness (SC-01 to SC-10) or honesty (CP-07, CP-08). Per-instance grants that the report tool cannot express (it grants an ID globally) are listed in FINDINGS.md, in its "Brand exceptions" table, with their line.

The TY-04 grant is global in the tool, but DESIGN.md limits the device to the 404 and the error page: a TY-04 anywhere else is still a finding, to be checked by eye.

Per instance, owner decision 2026-09-28: the alef over «عبدالله» on the home name bands crosses into the aubergine band above (SC-15 by eye). DESIGN.md §2: "The home page's name bands. A tall mark may cross the seam into the band above, in its own band's ink … No mark may be hidden, and no mark may merge with a mark of another line." SC-03 itself is never granted.
