# tasmeem measured after the fixes · /book reader (P02)

Measured: scan ✓ · built ✓ · render ✓
Totals: P0 0 · P1 7 · P2 2 · brand exceptions 0
Verdict: **PASS**

| # | ID | Sev | Where | Finding | Count | Evidence |
|---|---|---|---|---|---|---|
| 1 | LA-22 | P1 | http://localhost:3000/book @360 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.book-module__mwyVwq__heroText > div.book-module__mwyVwq_ |
| 2 | LA-22 | P1 | http://localhost:3000/book @768 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.book-module__mwyVwq__heroText > div.book-module__mwyVwq_ |
| 3 | LA-22 | P1 | http://localhost:3000/book @1024 | Buttons that wrap: control label wraps to two lines | 11 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 4 | LA-22 | P1 | http://localhost:3000/book @1440 | Buttons that wrap: control label wraps to two lines | 11 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 5 | TY-04 | P1 | out/book.html:33 | One accented word in the headline: one word styled differently inside the headline | 1 | <span class="t-mega book-module__mwyVwq__titleWord" data-enter="" data-fx="band" style="-- |
| 6 | TY-04 | P1 | src/components/public/book/BookView.tsx:50 | One accented word in the headline: one word styled differently inside the headline | 1 |  <span className={`t-mega ${styles.titleWord}`} {...enter(200, 'band')}> {BOOK.title} </sp |
| 7 | TY-05 | P1 | out/book.html:33 | Eyebrow above every heading: eyebrow label above a heading | 1 | <p class="book-module__mwyVwq__roomLabel" data-enter="" style="--enter-delay:80ms">كتبتُ ه |
| 8 | CO-13 | P2 | src/components/book/reader.module.css:124 | Repeating stripes as filler: repeating stripes | 1 | .case::before, .case::after |
| 9 | MO-09 | P2 | src/components/book/reader.module.css:95 | Slow or sluggish UI motion: UI transition 700ms | 1 | .flip |

Judged findings (eye) are added by the reviewer below this line and labelled as judgment.
