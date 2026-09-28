# tasmeem after the DESIGN-B fixes

Measured: scan ✓ · built ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓ · render ✓
Totals: P0 15 · P1 100 · P2 30 · brand exceptions 7
Verdict: **FAIL** (a P0, or a P1 accessibility/script/honesty finding, is open)

| # | ID | Sev | Where | Finding | Count | Evidence |
|---|---|---|---|---|---|---|
| 1 | CP-08 | P0 | out/policies/delivery.html:32 | Placeholder text: "نص تجريبي" | 1 | نص تجريبي يكتبه أنس ويعتمده قبل فتح المتجر. |
| 2 | CP-08 | P0 | out/policies/refund.html:32 | Placeholder text: "نص تجريبي" | 1 | نص تجريبي يكتبه أنس ويعتمده قبل فتح المتجر. |
| 3 | CP-08 | P0 | out/policies/store.html:32 | Placeholder text: "نص تجريبي" | 1 | نص تجريبي يكتبه أنس ويعتمده قبل فتح المتجر. |
| 4 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @360 | Script errors: 404 /this-page-does-not-exist | 1 |  |
| 5 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @360 | Script errors: console: Failed to load resource: the server responded with a status of 404 (Not Found) | 1 |  |
| 6 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @768 | Script errors: 404 /this-page-does-not-exist | 1 |  |
| 7 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @768 | Script errors: console: Failed to load resource: the server responded with a status of 404 (Not Found) | 1 |  |
| 8 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @1024 | Script errors: 404 /this-page-does-not-exist | 1 |  |
| 9 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @1024 | Script errors: console: Failed to load resource: the server responded with a status of 404 (Not Found) | 1 |  |
| 10 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @1440 | Script errors: 404 /this-page-does-not-exist | 1 |  |
| 11 | QA-07 | P0 | http://localhost:3000/this-page-does-not-exist @1440 | Script errors: console: Failed to load resource: the server responded with a status of 404 (Not Found) | 1 |  |
| 12 | QA-11 | P0 | http://localhost:3000/ @360 | Unnamed icon buttons: a without an accessible name | 1 | section.home-module__rj-LAW__book > section.band-module__D_o5aq__band > a.home-module__rj-LAW__cover |
| 13 | QA-11 | P0 | http://localhost:3000/ @1440 | Unnamed icon buttons: a without an accessible name | 1 | section.home-module__rj-LAW__book > section.band-module__D_o5aq__band > a.home-module__rj-LAW__cover |
| 14 | QA-11 | P0 | http://localhost:3000/ @768 | Unnamed icon buttons: a without an accessible name | 1 | section.home-module__rj-LAW__book > section.band-module__D_o5aq__band > a.home-module__rj-LAW__cover |
| 15 | QA-11 | P0 | http://localhost:3000/ @1024 | Unnamed icon buttons: a without an accessible name | 1 | section.home-module__rj-LAW__book > section.band-module__D_o5aq__band > a.home-module__rj-LAW__cover |
| 16 | CO-16 | P1 | (project) | Raw colour outside the tokens: 52 non-token file(s) with many raw colour literals | 1 |  |
| 17 | CP-03 | P1 | out/shelf.html:35 | "Not X, but Y" cadence: "ليست مجرد" | 1 | من قلب المباني النجدية وصحراء الجزيرة العربية ولدت قطعة فنية، تجسدت في شكل مثلثا |
| 18 | IG-09 | P1 | out/built.html | Layout-shifting media: first image is lazy-loaded (a likely LCP image) | 1 | <img src="/images/built/raha-logo-720.webp" width="720" height="720" alt="شعار رحى المكان" loading=" |
| 19 | IG-09 | P1 | out/passed.html | Layout-shifting media: first image is lazy-loaded (a likely LCP image) | 1 | <img src="/images/passed/soub-720.webp" width="720" height="720" alt="" loading="lazy" decoding="asy |
| 20 | IG-09 | P1 | out/shelf.html | Layout-shifting media: first image is lazy-loaded (a likely LCP image) | 1 | <img src="/images/shelf/thura-81-980.webp" width="980" height="1600" alt="" loading="lazy" decoding= |
| 21 | IG-09 | P1 | out/started.html | Layout-shifting media: first image is lazy-loaded (a likely LCP image) | 1 | <img src="/images/passed/31-murady-french-toast-banana-1200.webp" width="1200" height="869" alt="توس |
| 22 | LA-22 | P1 | http://localhost:3000/this-page-does-not-exist @360 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.lost-module__6hkCbq__panel > nav.lost-module__6hkCbq__wa |
| 23 | LA-22 | P1 | http://localhost:3000/this-page-does-not-exist @768 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.lost-module__6hkCbq__panel > nav.lost-module__6hkCbq__wa |
| 24 | LA-22 | P1 | http://localhost:3000/this-page-does-not-exist @1024 | Buttons that wrap: control label wraps to two lines | 12 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 25 | LA-22 | P1 | http://localhost:3000/this-page-does-not-exist @1440 | Buttons that wrap: control label wraps to two lines | 12 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 26 | LA-22 | P1 | http://localhost:3000/book @360 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.section-nav-module__nH-W7q__list > li > a.section-nav-mod |
| 27 | LA-22 | P1 | http://localhost:3000/book @1440 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 28 | LA-22 | P1 | http://localhost:3000/book @768 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.section-nav-module__nH-W7q__list > li > a.section-nav-mod |
| 29 | LA-22 | P1 | http://localhost:3000/book @1024 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 30 | LA-22 | P1 | http://localhost:3000/built @360 | Buttons that wrap: control label wraps to two lines | 9 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.built-module__xQJsLq__filmCell > div.video-module__LHblo |
| 31 | LA-22 | P1 | http://localhost:3000/built @768 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.built-module__xQJsLq__filmCell > div.video-module__LHblo |
| 32 | LA-22 | P1 | http://localhost:3000/built @1024 | Buttons that wrap: control label wraps to two lines | 9 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 33 | LA-22 | P1 | http://localhost:3000/built @1440 | Buttons that wrap: control label wraps to two lines | 9 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 34 | LA-22 | P1 | http://localhost:3000/cart @360 | Buttons that wrap: control label wraps to two lines | 3 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.store-module__ji0kVG__inner > div > a.store-module__ji0k |
| 35 | LA-22 | P1 | http://localhost:3000/cart @768 | Buttons that wrap: control label wraps to two lines | 3 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.store-module__ji0kVG__inner > div > a.store-module__ji0k |
| 36 | LA-22 | P1 | http://localhost:3000/cart @1024 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 37 | LA-22 | P1 | http://localhost:3000/cart @1440 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 38 | LA-22 | P1 | http://localhost:3000/checkout @360 | Buttons that wrap: control label wraps to two lines | 3 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.store-module__ji0kVG__inner > div > a.store-module__ji0k |
| 39 | LA-22 | P1 | http://localhost:3000/checkout @768 | Buttons that wrap: control label wraps to two lines | 3 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.store-module__ji0kVG__inner > div > a.store-module__ji0k |
| 40 | LA-22 | P1 | http://localhost:3000/checkout @1024 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 41 | LA-22 | P1 | http://localhost:3000/checkout @1440 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 42 | LA-22 | P1 | http://localhost:3000/contact @360 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.contact-module__QaVcTG__channels > li > a.contact-module_ |
| 43 | LA-22 | P1 | http://localhost:3000/contact @768 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.layout-module__M94H1q__lattice > li.contact-module__QaVcT |
| 44 | LA-22 | P1 | http://localhost:3000/contact @1024 | Buttons that wrap: control label wraps to two lines | 15 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 45 | LA-22 | P1 | http://localhost:3000/contact @1440 | Buttons that wrap: control label wraps to two lines | 13 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 46 | LA-22 | P1 | http://localhost:3000/ @360 | Buttons that wrap: control label wraps to two lines | 11 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ol.home-module__rj-LAW__doors > li.home-module__rj-LAW__door |
| 47 | LA-22 | P1 | http://localhost:3000/ @1440 | Buttons that wrap: control label wraps to two lines | 16 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 48 | LA-22 | P1 | http://localhost:3000/ @768 | Buttons that wrap: control label wraps to two lines | 11 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ol.home-module__rj-LAW__doors > li.home-module__rj-LAW__door |
| 49 | LA-22 | P1 | http://localhost:3000/ @1024 | Buttons that wrap: control label wraps to two lines | 14 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 50 | LA-22 | P1 | http://localhost:3000/journal @360 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| section.journal-module__-XRgIq__empty > div.journal-module__ |
| 51 | LA-22 | P1 | http://localhost:3000/journal @768 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| section.journal-module__-XRgIq__empty > div.journal-module__ |
| 52 | LA-22 | P1 | http://localhost:3000/journal @1024 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 53 | LA-22 | P1 | http://localhost:3000/journal @1440 | Buttons that wrap: control label wraps to two lines | 8 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 54 | LA-22 | P1 | http://localhost:3000/passed @360 | Buttons that wrap: control label wraps to two lines | 6 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| figure.passed-module__0Z4GEq__film > div.video-module__LHblo |
| 55 | LA-22 | P1 | http://localhost:3000/passed @768 | Buttons that wrap: control label wraps to two lines | 6 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| figure.passed-module__0Z4GEq__film > div.video-module__LHblo |
| 56 | LA-22 | P1 | http://localhost:3000/passed @1024 | Buttons that wrap: control label wraps to two lines | 9 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 57 | LA-22 | P1 | http://localhost:3000/passed @1440 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 58 | LA-22 | P1 | http://localhost:3000/policies/store @360 | Buttons that wrap: control label wraps to two lines | 2 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__footerRow > nav.site-module__oB1X9q |
| 59 | LA-22 | P1 | http://localhost:3000/policies/store @768 | Buttons that wrap: control label wraps to two lines | 2 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__footerRow > nav.site-module__oB1X9q |
| 60 | LA-22 | P1 | http://localhost:3000/policies/store @1024 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 61 | LA-22 | P1 | http://localhost:3000/policies/store @1440 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 62 | LA-22 | P1 | http://localhost:3000/scenes @360 | Buttons that wrap: control label wraps to two lines | 22 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| header.band-module__D_o5aq__band > div.scenes-module__rTE2bq |
| 63 | LA-22 | P1 | http://localhost:3000/scenes @768 | Buttons that wrap: control label wraps to two lines | 17 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| header.band-module__D_o5aq__band > div.scenes-module__rTE2bq |
| 64 | LA-22 | P1 | http://localhost:3000/scenes @1024 | Buttons that wrap: control label wraps to two lines | 22 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 65 | LA-22 | P1 | http://localhost:3000/scenes @1440 | Buttons that wrap: control label wraps to two lines | 22 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 66 | LA-22 | P1 | http://localhost:3000/shelf @360 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.layout-module__M94H1q__lattice > li > a.shelf-module__OW2 |
| 67 | LA-22 | P1 | http://localhost:3000/shelf @768 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.layout-module__M94H1q__lattice > li > a.shelf-module__OW2 |
| 68 | LA-22 | P1 | http://localhost:3000/shelf @1024 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 69 | LA-22 | P1 | http://localhost:3000/shelf @1440 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 70 | LA-22 | P1 | http://localhost:3000/started @360 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| li > div.video-module__LHbloq__tile > button.video-module__L |
| 71 | LA-22 | P1 | http://localhost:3000/started @768 | Buttons that wrap: control label wraps to two lines | 6 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| li > div.video-module__LHbloq__tile > button.video-module__L |
| 72 | LA-22 | P1 | http://localhost:3000/started @1024 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 73 | LA-22 | P1 | http://localhost:3000/started @1440 | Buttons that wrap: control label wraps to two lines | 7 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 74 | LA-22 | P1 | http://localhost:3000/store/demo-khous @360 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| li.store-module__ji0kVG__variant > div.store-module__ji0kVG_ |
| 75 | LA-22 | P1 | http://localhost:3000/store/demo-khous @768 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| li.store-module__ji0kVG__variant > div.store-module__ji0kVG_ |
| 76 | LA-22 | P1 | http://localhost:3000/store/demo-khous @1024 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 77 | LA-22 | P1 | http://localhost:3000/store/demo-khous @1440 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 78 | LA-22 | P1 | http://localhost:3000/store @360 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.store-module__ji0kVG__grid > li.store-module__ji0kVG__car |
| 79 | LA-22 | P1 | http://localhost:3000/store @768 | Buttons that wrap: control label wraps to two lines | 5 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| ul.store-module__ji0kVG__grid > li.store-module__ji0kVG__car |
| 80 | LA-22 | P1 | http://localhost:3000/store @1024 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 81 | LA-22 | P1 | http://localhost:3000/store @1440 | Buttons that wrap: control label wraps to two lines | 10 | header.site-module__oB1X9q__header > div.site-module__oB1X9q__bar > a.site-module__oB1X9q__brand \| div.site-module__oB1X9q__bar > nav.site-module__oB1X9q__inli |
| 82 | QA-03 | P1 | out/admin.html | Broken heading outline: no <h1> | 1 |  |
| 83 | QA-03 | P1 | out/admin/content.html | Broken heading outline: no <h1> | 1 |  |
| 84 | QA-03 | P1 | out/admin/content/policies.html | Broken heading outline: no <h1> | 1 |  |
| 85 | QA-03 | P1 | out/admin/content/policies/edit.html | Broken heading outline: no <h1> | 1 |  |
| 86 | QA-03 | P1 | out/admin/content/posts.html | Broken heading outline: no <h1> | 1 |  |
| 87 | QA-03 | P1 | out/admin/content/posts/edit.html | Broken heading outline: no <h1> | 1 |  |
| 88 | QA-03 | P1 | out/admin/content/rooms.html | Broken heading outline: no <h1> | 1 |  |
| 89 | QA-03 | P1 | out/admin/content/rooms/edit.html | Broken heading outline: no <h1> | 1 |  |
| 90 | QA-03 | P1 | out/admin/content/site_settings.html | Broken heading outline: no <h1> | 1 |  |
| 91 | QA-03 | P1 | out/admin/content/site_settings/edit.html | Broken heading outline: no <h1> | 1 |  |
| 92 | QA-03 | P1 | out/admin/content/taxonomies.html | Broken heading outline: no <h1> | 1 |  |
| 93 | QA-03 | P1 | out/admin/content/taxonomies/edit.html | Broken heading outline: no <h1> | 1 |  |
| 94 | QA-03 | P1 | out/admin/email.html | Broken heading outline: no <h1> | 1 |  |
| 95 | QA-03 | P1 | out/admin/media.html | Broken heading outline: no <h1> | 1 |  |
| 96 | QA-03 | P1 | out/admin/preview.html | Broken heading outline: no <h1> | 1 |  |
| 97 | QA-03 | P1 | out/admin/security.html | Broken heading outline: no <h1> | 1 |  |
| 98 | QA-03 | P1 | out/admin/settings.html | Broken heading outline: no <h1> | 1 |  |
| 99 | QA-03 | P1 | out/admin/stats.html | Broken heading outline: no <h1> | 1 |  |
| 100 | QA-03 | P1 | out/admin/store.html | Broken heading outline: no <h1> | 1 |  |
| 101 | QA-03 | P1 | out/admin/store/coupons.html | Broken heading outline: no <h1> | 1 |  |
| 102 | QA-03 | P1 | out/admin/store/coupons/edit.html | Broken heading outline: no <h1> | 1 |  |
| 103 | QA-03 | P1 | out/admin/store/customers.html | Broken heading outline: no <h1> | 1 |  |
| 104 | QA-03 | P1 | out/admin/store/customers/edit.html | Broken heading outline: no <h1> | 1 |  |
| 105 | QA-03 | P1 | out/admin/store/products.html | Broken heading outline: no <h1> | 1 |  |
| 106 | QA-03 | P1 | out/admin/store/products/edit.html | Broken heading outline: no <h1> | 1 |  |
| 107 | QA-03 | P1 | out/admin/store/shipping-rates.html | Broken heading outline: no <h1> | 1 |  |
| 108 | QA-03 | P1 | out/admin/store/shipping-rates/edit.html | Broken heading outline: no <h1> | 1 |  |
| 109 | QA-03 | P1 | out/admin/store/variants/edit.html | Broken heading outline: no <h1> | 1 |  |
| 110 | QA-03 | P1 | out/admin/team.html | Broken heading outline: no <h1> | 1 |  |
| 111 | SC-15 | P1 | http://localhost:3000/shelf @360 | Clipped marks: arabic marks clipped by overflow | 5 | ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour > p.visually-hidden \| ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour |
| 112 | SC-15 | P1 | http://localhost:3000/shelf @768 | Clipped marks: arabic marks clipped by overflow | 5 | ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour > p.visually-hidden \| ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour |
| 113 | SC-15 | P1 | http://localhost:3000/shelf @1024 | Clipped marks: arabic marks clipped by overflow | 5 | ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour > p.visually-hidden \| ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour |
| 114 | SC-15 | P1 | http://localhost:3000/shelf @1440 | Clipped marks: arabic marks clipped by overflow | 5 | ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour > p.visually-hidden \| ol.layout-module__M94H1q__lattice > li.shelf-module__OW2jNW__flavour |
| 115 | TY-05 | P1 | out/book.html:32 | Eyebrow above every heading: eyebrow label above a heading | 1 | <p class="book-module__mwyVwq__roomLabel" data-enter="" style="--enter-delay:80ms">كتبتُ ه |
| 116 | QA-12 | P2 | out/admin.html | No skip link: no skip link to the main content | 1 |  |
| 117 | QA-12 | P2 | out/admin/content.html | No skip link: no skip link to the main content | 1 |  |
| 118 | QA-12 | P2 | out/admin/content/policies.html | No skip link: no skip link to the main content | 1 |  |
| 119 | QA-12 | P2 | out/admin/content/policies/edit.html | No skip link: no skip link to the main content | 1 |  |
| 120 | QA-12 | P2 | out/admin/content/posts.html | No skip link: no skip link to the main content | 1 |  |
| 121 | QA-12 | P2 | out/admin/content/posts/edit.html | No skip link: no skip link to the main content | 1 |  |
| 122 | QA-12 | P2 | out/admin/content/rooms.html | No skip link: no skip link to the main content | 1 |  |
| 123 | QA-12 | P2 | out/admin/content/rooms/edit.html | No skip link: no skip link to the main content | 1 |  |
| 124 | QA-12 | P2 | out/admin/content/site_settings.html | No skip link: no skip link to the main content | 1 |  |
| 125 | QA-12 | P2 | out/admin/content/site_settings/edit.html | No skip link: no skip link to the main content | 1 |  |
| 126 | QA-12 | P2 | out/admin/content/taxonomies.html | No skip link: no skip link to the main content | 1 |  |
| 127 | QA-12 | P2 | out/admin/content/taxonomies/edit.html | No skip link: no skip link to the main content | 1 |  |
| 128 | QA-12 | P2 | out/admin/email.html | No skip link: no skip link to the main content | 1 |  |
| 129 | QA-12 | P2 | out/admin/media.html | No skip link: no skip link to the main content | 1 |  |
| 130 | QA-12 | P2 | out/admin/preview.html | No skip link: no skip link to the main content | 1 |  |
| 131 | QA-12 | P2 | out/admin/security.html | No skip link: no skip link to the main content | 1 |  |
| 132 | QA-12 | P2 | out/admin/settings.html | No skip link: no skip link to the main content | 1 |  |
| 133 | QA-12 | P2 | out/admin/sign-in.html | No skip link: no skip link to the main content | 1 |  |
| 134 | QA-12 | P2 | out/admin/stats.html | No skip link: no skip link to the main content | 1 |  |
| 135 | QA-12 | P2 | out/admin/store.html | No skip link: no skip link to the main content | 1 |  |
| 136 | QA-12 | P2 | out/admin/store/coupons.html | No skip link: no skip link to the main content | 1 |  |
| 137 | QA-12 | P2 | out/admin/store/coupons/edit.html | No skip link: no skip link to the main content | 1 |  |
| 138 | QA-12 | P2 | out/admin/store/customers.html | No skip link: no skip link to the main content | 1 |  |
| 139 | QA-12 | P2 | out/admin/store/customers/edit.html | No skip link: no skip link to the main content | 1 |  |
| 140 | QA-12 | P2 | out/admin/store/products.html | No skip link: no skip link to the main content | 1 |  |
| 141 | QA-12 | P2 | out/admin/store/products/edit.html | No skip link: no skip link to the main content | 1 |  |
| 142 | QA-12 | P2 | out/admin/store/shipping-rates.html | No skip link: no skip link to the main content | 1 |  |
| 143 | QA-12 | P2 | out/admin/store/shipping-rates/edit.html | No skip link: no skip link to the main content | 1 |  |
| 144 | QA-12 | P2 | out/admin/store/variants/edit.html | No skip link: no skip link to the main content | 1 |  |
| 145 | QA-12 | P2 | out/admin/team.html | No skip link: no skip link to the main content | 1 |  |

## Brand exceptions

| ID | Where | Finding | Granted by |
|---|---|---|---|
| TY-04 | src/app/(public)/error.tsx | one word styled differently inside the headline | EXCEPTIONS.md: the two-tone headline of the 404 and the error page (added 2026-09-28, FINDINGS row 17). DESIGN.md §2: "The 404 and the error page set their head |
| TY-04 | src/components/public/book/BookView.tsx | one word styled differently inside the headline | EXCEPTIONS.md: the two-tone headline of the 404 and the error page (added 2026-09-28, FINDINGS row 17). DESIGN.md §2: "The 404 and the error page set their head |
| TY-04 | src/components/public/Lost.tsx | one word styled differently inside the headline | EXCEPTIONS.md: the two-tone headline of the 404 and the error page (added 2026-09-28, FINDINGS row 17). DESIGN.md §2: "The 404 and the error page set their head |
| TY-04 | out/404.html | one word styled differently inside the headline | EXCEPTIONS.md: the two-tone headline of the 404 and the error page (added 2026-09-28, FINDINGS row 17). DESIGN.md §2: "The 404 and the error page set their head |
| TY-04 | out/admin/sign-in.html | one word styled differently inside the headline | EXCEPTIONS.md: the two-tone headline of the 404 and the error page (added 2026-09-28, FINDINGS row 17). DESIGN.md §2: "The 404 and the error page set their head |
| TY-04 | out/book.html | one word styled differently inside the headline | EXCEPTIONS.md: the two-tone headline of the 404 and the error page (added 2026-09-28, FINDINGS row 17). DESIGN.md §2: "The 404 and the error page set their head |
| TY-04 | out/contact.html | one word styled differently inside the headline | EXCEPTIONS.md: the two-tone headline of the 404 and the error page (added 2026-09-28, FINDINGS row 17). DESIGN.md §2: "The 404 and the error page set their head |

Judged findings (eye) are added by the reviewer below this line and labelled as judgment.
