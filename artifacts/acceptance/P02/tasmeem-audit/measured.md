# tasmeem measured · /book reader (P02)

Measured: scan ✓ · built ✓ · render ✓ · render ✓
Totals: P0 0 · P1 8 · P2 0 · brand exceptions 0
Verdict: **PASS**

| # | ID | Sev | Where | Finding | Count | Evidence |
|---|---|---|---|---|---|---|
| 1 | LA-22 | P1 | http://localhost:3000/book @360 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.book-module__mwyVwq__heroText > div.book-module__mwyVwq_ |
| 2 | LA-22 | P1 | http://localhost:3000/book @768 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.book-module__mwyVwq__heroText > div.book-module__mwyVwq_ |
| 3 | LA-22 | P1 | http://localhost:3000/book @1024 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 4 | LA-22 | P1 | http://localhost:3000/book @1440 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 5 | LA-22 | P1 | http://localhost:3000/book @390 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.book-module__mwyVwq__heroText > div.book-module__mwyVwq_ |
| 6 | TY-04 | P1 | out/book.html:33 | One accented word in the headline: one word styled differently inside the headline | 1 | <span class="t-mega book-module__mwyVwq__titleWord" data-enter="" data-fx="band" style="-- |
| 7 | TY-04 | P1 | src/components/public/book/BookView.tsx:50 | One accented word in the headline: one word styled differently inside the headline | 1 |  <span className={`t-mega ${styles.titleWord}`} {...enter(200, 'band')}> {BOOK.title} </sp |
| 8 | TY-05 | P1 | out/book.html:33 | Eyebrow above every heading: eyebrow label above a heading | 1 | <p class="book-module__mwyVwq__roomLabel" data-enter="" style="--enter-delay:80ms">كتبتُ ه |

Judged findings (eye) are added by the reviewer below this line and labelled as judgment.
