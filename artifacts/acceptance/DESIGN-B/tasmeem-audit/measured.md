# tasmeem report

Measured: scan ✓ · built ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓
Totals: P0 53 · P1 157 · P2 67 · brand exceptions 0
Verdict: **FAIL** (a P0, or a P1 accessibility/script/honesty finding, is open)

| # | ID | Sev | Where | Finding | Count | Evidence |
|---|---|---|---|---|---|---|
| 1 | CP-08 | P0 | out/policies/delivery.html:34 | Placeholder text: "نص تجريبي" | 1 | نص تجريبي يكتبه أنس ويعتمده قبل فتح المتجر. |
| 2 | CP-08 | P0 | out/policies/refund.html:34 | Placeholder text: "نص تجريبي" | 1 | نص تجريبي يكتبه أنس ويعتمده قبل فتح المتجر. |
| 3 | CP-08 | P0 | out/policies/store.html:34 | Placeholder text: "نص تجريبي" | 1 | نص تجريبي يكتبه أنس ويعتمده قبل فتح المتجر. |
| 4 | QA-04 | P0 | out/journal/_.html:1 | Missing language and direction: <html> without lang | 1 | <html id="__next_error__"> |
| 5 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @360 | Script errors: 404 /this-page-does-not-exist | 1 |  |
| 6 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @360 | Script errors: console: Failed to load resource: the server responded with a status of 404 (Not Found) | 1 |  |
| 7 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @768 | Script errors: 404 /this-page-does-not-exist | 1 |  |
| 8 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @768 | Script errors: console: Failed to load resource: the server responded with a status of 404 (Not Found) | 1 |  |
| 9 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @1024 | Script errors: 404 /this-page-does-not-exist | 1 |  |
| 10 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @1024 | Script errors: console: Failed to load resource: the server responded with a status of 404 (Not Found) | 1 |  |
| 11 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @1440 | Script errors: 404 /this-page-does-not-exist | 1 |  |
| 12 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @1440 | Script errors: console: Failed to load resource: the server responded with a status of 404 (Not Found) | 1 |  |
| 13 | QA-11 | P0 | http://localhost:3000/ @360 | Unnamed icon buttons: a without an accessible name | 1 | section.home-module__rj-LAW__book > section.band-module__D_o5aq__band > a.home-module__rj-LAW__cover |
| 14 | QA-11 | P0 | http://localhost:3000/ @768 | Unnamed icon buttons: a without an accessible name | 1 | section.home-module__rj-LAW__book > section.band-module__D_o5aq__band > a.home-module__rj-LAW__cover |
| 15 | QA-11 | P0 | http://localhost:3000/ @1024 | Unnamed icon buttons: a without an accessible name | 1 | section.home-module__rj-LAW__book > section.band-module__D_o5aq__band > a.home-module__rj-LAW__cover |
| 16 | QA-11 | P0 | http://localhost:3000/ @1440 | Unnamed icon buttons: a without an accessible name | 1 | section.home-module__rj-LAW__book > section.band-module__D_o5aq__band > a.home-module__rj-LAW__cover |
| 17 | SC-03 | P0 | http://localhost:3000/this-page-does-not-exist @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 18 | SC-03 | P0 | http://localhost:3000/this-page-does-not-exist @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 19 | SC-03 | P0 | http://localhost:3000/book @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 20 | SC-03 | P0 | http://localhost:3000/book @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 21 | SC-03 | P0 | http://localhost:3000/built @360 | Line height below the script's floor: arabic body line-height 1.45 (< 1.6) | 1 | header.band-module__D_o5aq__band > div.room-hero-module__SC32Ua__text > p.t-lead |
| 22 | SC-03 | P0 | http://localhost:3000/built @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 23 | SC-03 | P0 | http://localhost:3000/built @768 | Line height below the script's floor: arabic body line-height 1.45 (< 1.6) | 1 | header.band-module__D_o5aq__band > div.room-hero-module__SC32Ua__text > p.t-lead |
| 24 | SC-03 | P0 | http://localhost:3000/built @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 25 | SC-03 | P0 | http://localhost:3000/cart @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 26 | SC-03 | P0 | http://localhost:3000/cart @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 27 | SC-03 | P0 | http://localhost:3000/checkout @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 28 | SC-03 | P0 | http://localhost:3000/checkout @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 29 | SC-03 | P0 | http://localhost:3000/contact @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 30 | SC-03 | P0 | http://localhost:3000/contact @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 31 | SC-03 | P0 | http://localhost:3000/ @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 32 | SC-03 | P0 | http://localhost:3000/ @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 33 | SC-03 | P0 | http://localhost:3000/journal @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 34 | SC-03 | P0 | http://localhost:3000/journal @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 35 | SC-03 | P0 | http://localhost:3000/passed @360 | Line height below the script's floor: arabic body line-height 1.45 (< 1.6) | 1 | header.band-module__D_o5aq__band > div.room-hero-module__SC32Ua__text > p.t-lead |
| 36 | SC-03 | P0 | http://localhost:3000/passed @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 37 | SC-03 | P0 | http://localhost:3000/passed @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 38 | SC-03 | P0 | http://localhost:3000/policies/store @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 39 | SC-03 | P0 | http://localhost:3000/policies/store @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 40 | SC-03 | P0 | http://localhost:3000/scenes @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 41 | SC-03 | P0 | http://localhost:3000/scenes @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 42 | SC-03 | P0 | http://localhost:3000/shelf @360 | Line height below the script's floor: arabic body line-height 1.45 (< 1.6) | 1 | header.band-module__D_o5aq__band > div.room-hero-module__SC32Ua__text > p.t-lead |
| 43 | SC-03 | P0 | http://localhost:3000/shelf @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 44 | SC-03 | P0 | http://localhost:3000/shelf @768 | Line height below the script's floor: arabic body line-height 1.45 (< 1.6) | 1 | header.band-module__D_o5aq__band > div.room-hero-module__SC32Ua__text > p.t-lead |
| 45 | SC-03 | P0 | http://localhost:3000/shelf @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 46 | SC-03 | P0 | http://localhost:3000/started @360 | Line height below the script's floor: arabic body line-height 1.45 (< 1.6) | 1 | header.band-module__D_o5aq__band > div.room-hero-module__SC32Ua__text > p.t-lead |
| 47 | SC-03 | P0 | http://localhost:3000/started @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 48 | SC-03 | P0 | http://localhost:3000/started @768 | Line height below the script's floor: arabic body line-height 1.45 (< 1.6) | 1 | header.band-module__D_o5aq__band > div.room-hero-module__SC32Ua__text > p.t-lead |
| 49 | SC-03 | P0 | http://localhost:3000/started @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 50 | SC-03 | P0 | http://localhost:3000/store/demo-khous @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 51 | SC-03 | P0 | http://localhost:3000/store/demo-khous @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 52 | SC-03 | P0 | http://localhost:3000/store @360 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 53 | SC-03 | P0 | http://localhost:3000/store @768 | Line height below the script's floor: arabic body line-height 1.55 (< 1.6) | 1 | footer.site-module__oB1X9q__footer > p.site-module__oB1X9q__poem > span |
| 54 | CO-16 | P1 | (project) | Raw colour outside the tokens: 51 non-token file(s) with many raw colour literals | 1 |  |
| 55 | CP-03 | P1 | out/shelf.html:34 | "Not X, but Y" cadence: "ليست مجرد" | 1 | من قلب المباني النجدية وصحراء الجزيرة العربية ولدت قطعة فنية، تجسدت في شكل مثلثا |
| 56 | IG-09 | P1 | out/built.html | Layout-shifting media: first image is lazy-loaded (a likely LCP image) | 1 | <img src="/images/built/raha-logo-720.webp" width="720" height="720" alt="شعار رحى المكان" loading=" |
| 57 | IG-09 | P1 | out/journal.html | Layout-shifting media: first image is lazy-loaded (a likely LCP image) | 1 | <img src="/images/v2/street4-majlis-1400.webp" width="1400" height="1046" alt="مجلس البيت بكنباته ال |
| 58 | IG-09 | P1 | out/passed.html | Layout-shifting media: first image is lazy-loaded (a likely LCP image) | 1 | <img src="/images/passed/soub-720.webp" width="720" height="720" alt="" loading="lazy" decoding="asy |
| 59 | IG-09 | P1 | out/scenes.html | Layout-shifting media: first image is lazy-loaded (a likely LCP image) | 1 | <img src="/images/v2/street4-street-sign-1000.webp" srcSet="/images/v2/street4-street-sign-360.webp  |
| 60 | IG-09 | P1 | out/shelf.html | Layout-shifting media: first image is lazy-loaded (a likely LCP image) | 1 | <img src="/images/shelf/thura-81-980.webp" width="980" height="1600" alt="" loading="lazy" decoding= |
| 61 | IG-09 | P1 | out/started.html | Layout-shifting media: first image is lazy-loaded (a likely LCP image) | 1 | <img src="/images/passed/31-murady-french-toast-banana-1200.webp" width="1200" height="869" alt="توس |
| 62 | LA-22 | P1 | http://localhost:3000/this-page-does-not-exist @360 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.lost-module__6hkCbq__panel > nav.lost-module__6hkCbq__wa |
| 63 | LA-22 | P1 | http://localhost:3000/this-page-does-not-exist @768 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.lost-module__6hkCbq__panel > nav.lost-module__6hkCbq__wa |
| 64 | LA-22 | P1 | http://localhost:3000/this-page-does-not-exist @1024 | Buttons that wrap: control label wraps to two lines | 12 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 65 | LA-22 | P1 | http://localhost:3000/this-page-does-not-exist @1440 | Buttons that wrap: control label wraps to two lines | 12 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 66 | LA-22 | P1 | http://localhost:3000/admin/sign-in @360 | Buttons that wrap: control label wraps to two lines | 1 | div.admin-module__nc4JNq__page > form.admin-module__nc4JNq__form > button.admin-module__nc4JNq__button |
| 67 | LA-22 | P1 | http://localhost:3000/admin/sign-in @768 | Buttons that wrap: control label wraps to two lines | 1 | div.admin-module__nc4JNq__page > form.admin-module__nc4JNq__form > button.admin-module__nc4JNq__button |
| 68 | LA-22 | P1 | http://localhost:3000/admin/sign-in @1024 | Buttons that wrap: control label wraps to two lines | 1 | div.admin-module__nc4JNq__page > form.admin-module__nc4JNq__form > button.admin-module__nc4JNq__button |
| 69 | LA-22 | P1 | http://localhost:3000/admin/sign-in @1440 | Buttons that wrap: control label wraps to two lines | 1 | div.admin-module__nc4JNq__page > form.admin-module__nc4JNq__form > button.admin-module__nc4JNq__button |
| 70 | LA-22 | P1 | http://localhost:3000/admin @360 | Buttons that wrap: control label wraps to two lines | 1 | div.admin-module__nc4JNq__page > form.admin-module__nc4JNq__form > button.admin-module__nc4JNq__button |
| 71 | LA-22 | P1 | http://localhost:3000/admin @768 | Buttons that wrap: control label wraps to two lines | 1 | div.admin-module__nc4JNq__page > form.admin-module__nc4JNq__form > button.admin-module__nc4JNq__button |
| 72 | LA-22 | P1 | http://localhost:3000/admin @1024 | Buttons that wrap: control label wraps to two lines | 1 | div.admin-module__nc4JNq__page > form.admin-module__nc4JNq__form > button.admin-module__nc4JNq__button |
| 73 | LA-22 | P1 | http://localhost:3000/admin @1440 | Buttons that wrap: control label wraps to two lines | 1 | div.admin-module__nc4JNq__page > form.admin-module__nc4JNq__form > button.admin-module__nc4JNq__button |
| 74 | LA-22 | P1 | http://localhost:3000/book @360 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.section-nav-module__nH-W7q__list > li > a.section-nav-mod |
| 75 | LA-22 | P1 | http://localhost:3000/book @768 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.section-nav-module__nH-W7q__list > li > a.section-nav-mod |
| 76 | LA-22 | P1 | http://localhost:3000/book @1024 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 77 | LA-22 | P1 | http://localhost:3000/book @1440 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 78 | LA-22 | P1 | http://localhost:3000/built @360 | Buttons that wrap: control label wraps to two lines | 9 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.built-module__xQJsLq__filmCell > div.video-module__LHblo |
| 79 | LA-22 | P1 | http://localhost:3000/built @768 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.built-module__xQJsLq__filmCell > div.video-module__LHblo |
| 80 | LA-22 | P1 | http://localhost:3000/built @1024 | Buttons that wrap: control label wraps to two lines | 9 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 81 | LA-22 | P1 | http://localhost:3000/built @1440 | Buttons that wrap: control label wraps to two lines | 9 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 82 | LA-22 | P1 | http://localhost:3000/cart @360 | Buttons that wrap: control label wraps to two lines | 3 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.store-module__ji0kVG__inner > div > a.store-module__ji0k |
| 83 | LA-22 | P1 | http://localhost:3000/cart @768 | Buttons that wrap: control label wraps to two lines | 3 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.store-module__ji0kVG__inner > div > a.store-module__ji0k |
| 84 | LA-22 | P1 | http://localhost:3000/cart @1024 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 85 | LA-22 | P1 | http://localhost:3000/cart @1440 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 86 | LA-22 | P1 | http://localhost:3000/checkout @360 | Buttons that wrap: control label wraps to two lines | 3 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.store-module__ji0kVG__inner > div > a.store-module__ji0k |
| 87 | LA-22 | P1 | http://localhost:3000/checkout @768 | Buttons that wrap: control label wraps to two lines | 3 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.store-module__ji0kVG__inner > div > a.store-module__ji0k |
| 88 | LA-22 | P1 | http://localhost:3000/checkout @1024 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 89 | LA-22 | P1 | http://localhost:3000/checkout @1440 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 90 | LA-22 | P1 | http://localhost:3000/contact @360 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.contact-module__QaVcTG__channels > li > a.contact-module_ |
| 91 | LA-22 | P1 | http://localhost:3000/contact @768 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.layout-module__M94H1q__lattice > li.contact-module__QaVcT |
| 92 | LA-22 | P1 | http://localhost:3000/contact @1024 | Buttons that wrap: control label wraps to two lines | 15 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 93 | LA-22 | P1 | http://localhost:3000/contact @1440 | Buttons that wrap: control label wraps to two lines | 13 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 94 | LA-22 | P1 | http://localhost:3000/ @360 | Buttons that wrap: control label wraps to two lines | 11 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ol.home-module__rj-LAW__doors > li.home-module__rj-LAW__door |
| 95 | LA-22 | P1 | http://localhost:3000/ @768 | Buttons that wrap: control label wraps to two lines | 11 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ol.home-module__rj-LAW__doors > li.home-module__rj-LAW__door |
| 96 | LA-22 | P1 | http://localhost:3000/ @1024 | Buttons that wrap: control label wraps to two lines | 14 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 97 | LA-22 | P1 | http://localhost:3000/ @1440 | Buttons that wrap: control label wraps to two lines | 16 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 98 | LA-22 | P1 | http://localhost:3000/journal @360 | Buttons that wrap: control label wraps to two lines | 4 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| body > nav.roomnav-module__kjwDqG__nav > a.roomnav-module__k |
| 99 | LA-22 | P1 | http://localhost:3000/journal @768 | Buttons that wrap: control label wraps to two lines | 4 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| body > nav.roomnav-module__kjwDqG__nav > a.roomnav-module__k |
| 100 | LA-22 | P1 | http://localhost:3000/journal @1024 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 101 | LA-22 | P1 | http://localhost:3000/journal @1440 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 102 | LA-22 | P1 | http://localhost:3000/passed @360 | Buttons that wrap: control label wraps to two lines | 6 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| figure.passed-module__0Z4GEq__film > div.video-module__LHblo |
| 103 | LA-22 | P1 | http://localhost:3000/passed @768 | Buttons that wrap: control label wraps to two lines | 6 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| figure.passed-module__0Z4GEq__film > div.video-module__LHblo |
| 104 | LA-22 | P1 | http://localhost:3000/passed @1024 | Buttons that wrap: control label wraps to two lines | 9 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 105 | LA-22 | P1 | http://localhost:3000/passed @1440 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 106 | LA-22 | P1 | http://localhost:3000/policies/store @360 | Buttons that wrap: control label wraps to two lines | 2 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__footerRow > nav.site-module__oB1X9q |
| 107 | LA-22 | P1 | http://localhost:3000/policies/store @768 | Buttons that wrap: control label wraps to two lines | 2 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__footerRow > nav.site-module__oB1X9q |
| 108 | LA-22 | P1 | http://localhost:3000/policies/store @1024 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 109 | LA-22 | P1 | http://localhost:3000/policies/store @1440 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 110 | LA-22 | P1 | http://localhost:3000/scenes @360 | Buttons that wrap: control label wraps to two lines | 22 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| header.band-module__D_o5aq__band > div.scenes-module__rTE2bq |
| 111 | LA-22 | P1 | http://localhost:3000/scenes @768 | Buttons that wrap: control label wraps to two lines | 17 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| header.band-module__D_o5aq__band > div.scenes-module__rTE2bq |
| 112 | LA-22 | P1 | http://localhost:3000/scenes @1024 | Buttons that wrap: control label wraps to two lines | 22 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 113 | LA-22 | P1 | http://localhost:3000/scenes @1440 | Buttons that wrap: control label wraps to two lines | 22 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 114 | LA-22 | P1 | http://localhost:3000/shelf @360 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.layout-module__M94H1q__lattice > li > a.shelf-module__OW2 |
| 115 | LA-22 | P1 | http://localhost:3000/shelf @768 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.layout-module__M94H1q__lattice > li > a.shelf-module__OW2 |
| 116 | LA-22 | P1 | http://localhost:3000/shelf @1024 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 117 | LA-22 | P1 | http://localhost:3000/shelf @1440 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 118 | LA-22 | P1 | http://localhost:3000/started @360 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| li > div.video-module__LHbloq__tile > button.video-module__L |
| 119 | LA-22 | P1 | http://localhost:3000/started @768 | Buttons that wrap: control label wraps to two lines | 6 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| li > div.video-module__LHbloq__tile > button.video-module__L |
| 120 | LA-22 | P1 | http://localhost:3000/started @1024 | Buttons that wrap: control label wraps to two lines | 9 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 121 | LA-22 | P1 | http://localhost:3000/started @1440 | Buttons that wrap: control label wraps to two lines | 9 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 122 | LA-22 | P1 | http://localhost:3000/store/demo-khous @360 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| li.store-module__ji0kVG__variant > div.store-module__ji0kVG_ |
| 123 | LA-22 | P1 | http://localhost:3000/store/demo-khous @768 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| li.store-module__ji0kVG__variant > div.store-module__ji0kVG_ |
| 124 | LA-22 | P1 | http://localhost:3000/store/demo-khous @1024 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 125 | LA-22 | P1 | http://localhost:3000/store/demo-khous @1440 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 126 | LA-22 | P1 | http://localhost:3000/store @360 | Buttons that wrap: control label wraps to two lines | 2 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__footerRow > nav.site-module__oB1X9q |
| 127 | LA-22 | P1 | http://localhost:3000/store @768 | Buttons that wrap: control label wraps to two lines | 2 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__footerRow > nav.site-module__oB1X9q |
| 128 | LA-22 | P1 | http://localhost:3000/store @1024 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 129 | LA-22 | P1 | http://localhost:3000/store @1440 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 130 | QA-03 | P1 | out/admin.html | Broken heading outline: no <h1> | 1 |  |
| 131 | QA-03 | P1 | out/admin/content.html | Broken heading outline: no <h1> | 1 |  |
| 132 | QA-03 | P1 | out/admin/content/policies.html | Broken heading outline: no <h1> | 1 |  |
| 133 | QA-03 | P1 | out/admin/content/policies/edit.html | Broken heading outline: no <h1> | 1 |  |
| 134 | QA-03 | P1 | out/admin/content/posts.html | Broken heading outline: no <h1> | 1 |  |
| 135 | QA-03 | P1 | out/admin/content/posts/edit.html | Broken heading outline: no <h1> | 1 |  |
| 136 | QA-03 | P1 | out/admin/content/rooms.html | Broken heading outline: no <h1> | 1 |  |
| 137 | QA-03 | P1 | out/admin/content/rooms/edit.html | Broken heading outline: no <h1> | 1 |  |
| 138 | QA-03 | P1 | out/admin/content/site_settings.html | Broken heading outline: no <h1> | 1 |  |
| 139 | QA-03 | P1 | out/admin/content/site_settings/edit.html | Broken heading outline: no <h1> | 1 |  |
| 140 | QA-03 | P1 | out/admin/content/taxonomies.html | Broken heading outline: no <h1> | 1 |  |
| 141 | QA-03 | P1 | out/admin/content/taxonomies/edit.html | Broken heading outline: no <h1> | 1 |  |
| 142 | QA-03 | P1 | out/admin/email.html | Broken heading outline: no <h1> | 1 |  |
| 143 | QA-03 | P1 | out/admin/media.html | Broken heading outline: no <h1> | 1 |  |
| 144 | QA-03 | P1 | out/admin/preview.html | Broken heading outline: no <h1> | 1 |  |
| 145 | QA-03 | P1 | out/admin/security.html | Broken heading outline: no <h1> | 1 |  |
| 146 | QA-03 | P1 | out/admin/settings.html | Broken heading outline: no <h1> | 1 |  |
| 147 | QA-03 | P1 | out/admin/stats.html | Broken heading outline: no <h1> | 1 |  |
| 148 | QA-03 | P1 | out/admin/store.html | Broken heading outline: no <h1> | 1 |  |
| 149 | QA-03 | P1 | out/admin/store/coupons.html | Broken heading outline: no <h1> | 1 |  |
| 150 | QA-03 | P1 | out/admin/store/coupons/edit.html | Broken heading outline: no <h1> | 1 |  |
| 151 | QA-03 | P1 | out/admin/store/customers.html | Broken heading outline: no <h1> | 1 |  |
| 152 | QA-03 | P1 | out/admin/store/customers/edit.html | Broken heading outline: no <h1> | 1 |  |
| 153 | QA-03 | P1 | out/admin/store/products.html | Broken heading outline: no <h1> | 1 |  |
| 154 | QA-03 | P1 | out/admin/store/products/edit.html | Broken heading outline: no <h1> | 1 |  |
| 155 | QA-03 | P1 | out/admin/store/shipping-rates.html | Broken heading outline: no <h1> | 1 |  |
| 156 | QA-03 | P1 | out/admin/store/shipping-rates/edit.html | Broken heading outline: no <h1> | 1 |  |
| 157 | QA-03 | P1 | out/admin/store/variants/edit.html | Broken heading outline: no <h1> | 1 |  |
| 158 | QA-03 | P1 | out/admin/team.html | Broken heading outline: no <h1> | 1 |  |
| 159 | QA-03 | P1 | out/journal/_.html | Broken heading outline: no <h1> | 1 |  |
| 160 | QA-05 | P1 | http://localhost:3000/journal @360 | Small targets: target smaller than 44×44 | 1 | section.journal-module__-XRgIq__empty > div.journal-module__-XRgIq__emptyText > a.t-label |
| 161 | QA-05 | P1 | http://localhost:3000/journal @768 | Small targets: target smaller than 44×44 | 1 | section.journal-module__-XRgIq__empty > div.journal-module__-XRgIq__emptyText > a.t-label |
| 162 | QA-05 | P1 | http://localhost:3000/journal @1024 | Small targets: target smaller than 44×44 | 1 | section.journal-module__-XRgIq__empty > div.journal-module__-XRgIq__emptyText > a.t-label |
| 163 | QA-05 | P1 | http://localhost:3000/journal @1440 | Small targets: target smaller than 44×44 | 1 | section.journal-module__-XRgIq__empty > div.journal-module__-XRgIq__emptyText > a.t-label |
| 164 | QA-05 | P1 | http://localhost:3000/started @360 | Small targets: target smaller than 44×44 | 1 | figcaption.figure-module__E35f6q__below > span.story-module__DZdz3a__captionLink > a |
| 165 | QA-05 | P1 | http://localhost:3000/started @768 | Small targets: target smaller than 44×44 | 1 | figcaption.figure-module__E35f6q__below > span.story-module__DZdz3a__captionLink > a |
| 166 | QA-05 | P1 | http://localhost:3000/started @1024 | Small targets: target smaller than 44×44 | 1 | figcaption.figure-module__E35f6q__below > span.story-module__DZdz3a__captionLink > a |
| 167 | QA-05 | P1 | http://localhost:3000/started @1440 | Small targets: target smaller than 44×44 | 1 | figcaption.figure-module__E35f6q__below > span.story-module__DZdz3a__captionLink > a |
| 168 | QA-05 | P1 | http://localhost:3000/store/demo-khous @360 | Small targets: target smaller than 44×44 | 1 | main#main > header.band-module__D_o5aq__band > a.store-module__ji0kVG__cartLink |
| 169 | QA-05 | P1 | http://localhost:3000/store/demo-khous @768 | Small targets: target smaller than 44×44 | 1 | main#main > header.band-module__D_o5aq__band > a.store-module__ji0kVG__cartLink |
| 170 | QA-05 | P1 | http://localhost:3000/store/demo-khous @1024 | Small targets: target smaller than 44×44 | 1 | main#main > header.band-module__D_o5aq__band > a.store-module__ji0kVG__cartLink |
| 171 | QA-05 | P1 | http://localhost:3000/store/demo-khous @1440 | Small targets: target smaller than 44×44 | 1 | main#main > header.band-module__D_o5aq__band > a.store-module__ji0kVG__cartLink |
| 172 | QA-05 | P1 | http://localhost:3000/store @360 | Small targets: target smaller than 44×44 | 4 | main#main > header.band-module__D_o5aq__band > a.store-module__ji0kVG__cartLink \| ul.store-module__ji0kVG__grid > li.store-module__ji0kVG__card > a.store-modul |
| 173 | QA-05 | P1 | http://localhost:3000/store @768 | Small targets: target smaller than 44×44 | 4 | main#main > header.band-module__D_o5aq__band > a.store-module__ji0kVG__cartLink \| ul.store-module__ji0kVG__grid > li.store-module__ji0kVG__card > a.store-modul |
| 174 | QA-05 | P1 | http://localhost:3000/store @1024 | Small targets: target smaller than 44×44 | 4 | main#main > header.band-module__D_o5aq__band > a.store-module__ji0kVG__cartLink \| ul.store-module__ji0kVG__grid > li.store-module__ji0kVG__card > a.store-modul |
| 175 | QA-05 | P1 | http://localhost:3000/store @1440 | Small targets: target smaller than 44×44 | 1 | main#main > header.band-module__D_o5aq__band > a.store-module__ji0kVG__cartLink |
| 176 | SC-03 | P1 | http://localhost:3000/book @360 | Line height below the script's floor: arabic display line-height 1.15 (< 1.25) | 2 | h2#photos-title \| h2#journey-title |
| 177 | SC-03 | P1 | http://localhost:3000/book @768 | Line height below the script's floor: arabic display line-height 1.15 (< 1.25) | 1 | h2#photos-title |
| 178 | SC-03 | P1 | http://localhost:3000/book @1024 | Line height below the script's floor: arabic display line-height 1.15 (< 1.25) | 1 | h2#photos-title |
| 179 | SC-03 | P1 | http://localhost:3000/book @1440 | Line height below the script's floor: arabic display line-height 1.15 (< 1.25) | 1 | h2#photos-title |
| 180 | SC-03 | P1 | http://localhost:3000/built @360 | Line height below the script's floor: arabic display line-height 1.20 (< 1.25) | 1 | article > section.band-module__D_o5aq__band > p.t-band-xl |
| 181 | SC-03 | P1 | http://localhost:3000/contact @360 | Line height below the script's floor: arabic display line-height 1.22 (< 1.25) | 1 | header.band-module__D_o5aq__band > h1.t-band-xl > span.contact-module__QaVcTG__titleLine |
| 182 | SC-03 | P1 | http://localhost:3000/contact @768 | Line height below the script's floor: arabic display line-height 1.22 (< 1.25) | 1 | header.band-module__D_o5aq__band > h1.t-band-xl > span.contact-module__QaVcTG__titleLine |
| 183 | SC-03 | P1 | http://localhost:3000/contact @1024 | Line height below the script's floor: arabic display line-height 1.22 (< 1.25) | 1 | header.band-module__D_o5aq__band > h1.t-band-xl > span.contact-module__QaVcTG__titleLine |
| 184 | SC-03 | P1 | http://localhost:3000/contact @1440 | Line height below the script's floor: arabic display line-height 1.22 (< 1.25) | 1 | header.band-module__D_o5aq__band > h1.t-band-xl > span.contact-module__QaVcTG__titleLine |
| 185 | SC-03 | P1 | http://localhost:3000/ @360 | Line height below the script's floor: arabic display line-height 1.10 (< 1.25) | 1 | h2#rooms-title |
| 186 | SC-03 | P1 | http://localhost:3000/ @768 | Line height below the script's floor: arabic display line-height 1.10 (< 1.25) | 1 | h2#rooms-title |
| 187 | SC-03 | P1 | http://localhost:3000/ @1024 | Line height below the script's floor: arabic display line-height 1.10 (< 1.25) | 1 | h2#rooms-title |
| 188 | SC-03 | P1 | http://localhost:3000/ @1440 | Line height below the script's floor: arabic display line-height 1.10 (< 1.25) | 1 | h2#rooms-title |
| 189 | SC-03 | P1 | http://localhost:3000/journal @360 | Line height below the script's floor: arabic display line-height 1.15 (< 1.25) | 1 | section.journal-module__-XRgIq__empty > div.journal-module__-XRgIq__emptyText > p.t-h2 |
| 190 | SC-03 | P1 | http://localhost:3000/journal @768 | Line height below the script's floor: arabic display line-height 1.15 (< 1.25) | 1 | section.journal-module__-XRgIq__empty > div.journal-module__-XRgIq__emptyText > p.t-h2 |
| 191 | SC-03 | P1 | http://localhost:3000/journal @1024 | Line height below the script's floor: arabic display line-height 1.15 (< 1.25) | 1 | section.journal-module__-XRgIq__empty > div.journal-module__-XRgIq__emptyText > p.t-h2 |
| 192 | SC-03 | P1 | http://localhost:3000/journal @1440 | Line height below the script's floor: arabic display line-height 1.15 (< 1.25) | 1 | section.journal-module__-XRgIq__empty > div.journal-module__-XRgIq__emptyText > p.t-h2 |
| 193 | SC-03 | P1 | http://localhost:3000/passed @360 | Line height below the script's floor: arabic display line-height 1.10 (< 1.25) | 1 | header.band-module__D_o5aq__band > div.room-hero-module__SC32Ua__text > h1.t-title |
| 194 | SC-03 | P1 | http://localhost:3000/passed @360 | Line height below the script's floor: arabic display line-height 1.22 (< 1.25) | 1 | article > section.band-module__D_o5aq__band > p.t-band-xl |
| 195 | SC-03 | P1 | http://localhost:3000/shelf @360 | Line height below the script's floor: arabic display line-height 1.15 (< 1.25) | 2 | a.shelf-module__OW2jNW__door > span.shelf-module__OW2jNW__doorFoot > span.t-card \| article#thura > section.band-module__D_o5aq__band > p.t-band-xl |
| 196 | SC-03 | P1 | http://localhost:3000/shelf @360 | Line height below the script's floor: arabic display line-height 1.22 (< 1.25) | 1 | article#thura > section.band-module__D_o5aq__band > p.t-band-xl |
| 197 | SC-03 | P1 | http://localhost:3000/shelf @768 | Line height below the script's floor: arabic display line-height 1.15 (< 1.25) | 1 | a.shelf-module__OW2jNW__door > span.shelf-module__OW2jNW__doorFoot > span.t-card |
| 198 | SC-03 | P1 | http://localhost:3000/shelf @1024 | Line height below the script's floor: arabic display line-height 1.15 (< 1.25) | 1 | a.shelf-module__OW2jNW__door > span.shelf-module__OW2jNW__doorFoot > span.t-card |
| 199 | SC-03 | P1 | http://localhost:3000/started @360 | Line height below the script's floor: arabic display line-height 1.22 (< 1.25) | 1 | section#year-3 > section.band-module__D_o5aq__band > p.t-band-xl |
| 200 | SC-15 | P1 | http://localhost:3000/shelf @360 | Clipped marks: arabic marks clipped by overflow | 5 | ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour > p.visually-hidden \| ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour |
| 201 | SC-15 | P1 | http://localhost:3000/shelf @768 | Clipped marks: arabic marks clipped by overflow | 5 | ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour > p.visually-hidden \| ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour |
| 202 | SC-15 | P1 | http://localhost:3000/shelf @1024 | Clipped marks: arabic marks clipped by overflow | 5 | ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour > p.visually-hidden \| ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour |
| 203 | SC-15 | P1 | http://localhost:3000/shelf @1440 | Clipped marks: arabic marks clipped by overflow | 5 | ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour > p.visually-hidden \| ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour |
| 204 | TY-04 | P1 | out/404.html:31 | One accented word in the headline: one word styled differently inside the headline | 1 | <span data-enter="" data-fx="band" style="--enter-delay:80ms">هذا الطريق</span> <span clas |
| 205 | TY-04 | P1 | out/book.html:31 | One accented word in the headline: one word styled differently inside the headline | 1 | <span class="t-mega book-module__mwyVwq__titleWord" data-enter="" data-fx="band" style="-- |
| 206 | TY-04 | P1 | out/contact.html:31 | One accented word in the headline: one word styled differently inside the headline | 1 | <span class="contact-module__QaVcTG__titleLine" data-enter="" data-fx="band" style="--ente |
| 207 | TY-04 | P1 | src/app/(public)/error.tsx:15 | One accented word in the headline: one word styled differently inside the headline | 1 |  حدث خطأ <span className="t-accent">غير متوقع</span>  |
| 208 | TY-04 | P1 | src/components/public/book/BookView.tsx:45 | One accented word in the headline: one word styled differently inside the headline | 1 |  <span className={`t-mega ${styles.titleWord}`} {...enter(200, 'band')}> {BOOK.title} </sp |
| 209 | TY-04 | P1 | src/components/public/Lost.tsx:18 | One accented word in the headline: one word styled differently inside the headline | 1 |  <span {...enter(80, 'band')}>{title}</span> <span className="t-accent" {...enter(260, 'ba |
| 210 | TY-05 | P1 | out/book.html:31 | Eyebrow above every heading: eyebrow label above a heading | 1 | <p class="book-module__mwyVwq__roomLabel" data-enter="" style="--enter-delay:80ms">كتبتُ ه |
| 211 | MO-09 | P2 | out/404.html:15 | Slow or sluggish UI motion: UI transition 500ms | 3 | .site-module__oB1X9q__header |
| 212 | MO-09 | P2 | src/components/public/scenes/scenes.module.css:79 | Slow or sluggish UI motion: UI transition 800ms | 1 | .open img |
| 213 | MO-09 | P2 | src/components/site/site.module.css:9 | Slow or sluggish UI motion: UI transition 500ms | 1 | .header |
| 214 | MO-09 | P2 | src/components/weave/section-nav.module.css:8 | Slow or sluggish UI motion: UI transition 500ms | 1 | .bar |
| 215 | QA-12 | P2 | out/admin.html | No skip link: no skip link to the main content | 1 |  |
| 216 | QA-12 | P2 | out/admin/content.html | No skip link: no skip link to the main content | 1 |  |
| 217 | QA-12 | P2 | out/admin/content/policies.html | No skip link: no skip link to the main content | 1 |  |
| 218 | QA-12 | P2 | out/admin/content/policies/edit.html | No skip link: no skip link to the main content | 1 |  |
| 219 | QA-12 | P2 | out/admin/content/posts.html | No skip link: no skip link to the main content | 1 |  |
| 220 | QA-12 | P2 | out/admin/content/posts/edit.html | No skip link: no skip link to the main content | 1 |  |
| 221 | QA-12 | P2 | out/admin/content/rooms.html | No skip link: no skip link to the main content | 1 |  |
| 222 | QA-12 | P2 | out/admin/content/rooms/edit.html | No skip link: no skip link to the main content | 1 |  |
| 223 | QA-12 | P2 | out/admin/content/site_settings.html | No skip link: no skip link to the main content | 1 |  |
| 224 | QA-12 | P2 | out/admin/content/site_settings/edit.html | No skip link: no skip link to the main content | 1 |  |
| 225 | QA-12 | P2 | out/admin/content/taxonomies.html | No skip link: no skip link to the main content | 1 |  |
| 226 | QA-12 | P2 | out/admin/content/taxonomies/edit.html | No skip link: no skip link to the main content | 1 |  |
| 227 | QA-12 | P2 | out/admin/email.html | No skip link: no skip link to the main content | 1 |  |
| 228 | QA-12 | P2 | out/admin/media.html | No skip link: no skip link to the main content | 1 |  |
| 229 | QA-12 | P2 | out/admin/preview.html | No skip link: no skip link to the main content | 1 |  |
| 230 | QA-12 | P2 | out/admin/security.html | No skip link: no skip link to the main content | 1 |  |
| 231 | QA-12 | P2 | out/admin/settings.html | No skip link: no skip link to the main content | 1 |  |
| 232 | QA-12 | P2 | out/admin/sign-in.html | No skip link: no skip link to the main content | 1 |  |
| 233 | QA-12 | P2 | out/admin/stats.html | No skip link: no skip link to the main content | 1 |  |
| 234 | QA-12 | P2 | out/admin/store.html | No skip link: no skip link to the main content | 1 |  |
| 235 | QA-12 | P2 | out/admin/store/coupons.html | No skip link: no skip link to the main content | 1 |  |
| 236 | QA-12 | P2 | out/admin/store/coupons/edit.html | No skip link: no skip link to the main content | 1 |  |
| 237 | QA-12 | P2 | out/admin/store/customers.html | No skip link: no skip link to the main content | 1 |  |
| 238 | QA-12 | P2 | out/admin/store/customers/edit.html | No skip link: no skip link to the main content | 1 |  |
| 239 | QA-12 | P2 | out/admin/store/products.html | No skip link: no skip link to the main content | 1 |  |
| 240 | QA-12 | P2 | out/admin/store/products/edit.html | No skip link: no skip link to the main content | 1 |  |
| 241 | QA-12 | P2 | out/admin/store/shipping-rates.html | No skip link: no skip link to the main content | 1 |  |
| 242 | QA-12 | P2 | out/admin/store/shipping-rates/edit.html | No skip link: no skip link to the main content | 1 |  |
| 243 | QA-12 | P2 | out/admin/store/variants/edit.html | No skip link: no skip link to the main content | 1 |  |
| 244 | QA-12 | P2 | out/admin/team.html | No skip link: no skip link to the main content | 1 |  |
| 245 | QA-12 | P2 | out/journal/_.html | No skip link: no skip link to the main content | 1 |  |
| 246 | QA-14 | P2 | out/_not-found.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 247 | QA-14 | P2 | out/404.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 248 | QA-14 | P2 | out/admin.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 249 | QA-14 | P2 | out/admin/content.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 250 | QA-14 | P2 | out/admin/content/policies.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 251 | QA-14 | P2 | out/admin/content/policies/edit.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 252 | QA-14 | P2 | out/admin/content/posts.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 253 | QA-14 | P2 | out/admin/content/posts/edit.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 254 | QA-14 | P2 | out/admin/content/rooms.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 255 | QA-14 | P2 | out/admin/content/rooms/edit.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 256 | QA-14 | P2 | out/admin/content/site_settings.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 257 | QA-14 | P2 | out/admin/content/site_settings/edit.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 258 | QA-14 | P2 | out/admin/content/taxonomies.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 259 | QA-14 | P2 | out/admin/content/taxonomies/edit.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 260 | QA-14 | P2 | out/admin/email.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 261 | QA-14 | P2 | out/admin/media.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 262 | QA-14 | P2 | out/admin/preview.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 263 | QA-14 | P2 | out/admin/security.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 264 | QA-14 | P2 | out/admin/settings.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 265 | QA-14 | P2 | out/admin/sign-in.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 266 | QA-14 | P2 | out/admin/stats.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 267 | QA-14 | P2 | out/admin/store.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 268 | QA-14 | P2 | out/admin/store/coupons.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 269 | QA-14 | P2 | out/admin/store/coupons/edit.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 270 | QA-14 | P2 | out/admin/store/customers.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 271 | QA-14 | P2 | out/admin/store/customers/edit.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 272 | QA-14 | P2 | out/admin/store/products.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 273 | QA-14 | P2 | out/admin/store/products/edit.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 274 | QA-14 | P2 | out/admin/store/shipping-rates.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 275 | QA-14 | P2 | out/admin/store/shipping-rates/edit.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 276 | QA-14 | P2 | out/admin/store/variants/edit.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |
| 277 | QA-14 | P2 | out/admin/team.html | Theme metadata mismatch: no <meta name="theme-color"> | 1 |  |

Judged findings (eye) are added by the reviewer below this line and labelled as judgment.
