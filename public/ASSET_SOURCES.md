# Asset sources

## Public homepage

- `src/assets/public/circular-textiles-hero.jpg`: original AI-generated illustrative textile photograph, created with the built-in image-generation tool on October 16, 2026 and converted to JPEG for delivery. It is not documentary evidence of participants, collections, or a partner facility. Original generated PNG retained in the local generated-images archive.
- Final generation prompt: "Use case: photorealistic-natural. Asset type: full-bleed public homepage hero for BalikTelaPH, a Philippine circular textile research initiative. Create a refined editorial still-life photograph, landscape 16:9. On the RIGHT HALF of a very light cool off-white matte worktable: a thoughtfully arranged pile of beautifully tactile used indigo denim jeans, folded faded blue cotton, a small roll of pale sage woven fabric, white cotton scraps with frayed edges, and one patchwork textile showing a careful visible repair. Textiles are the clearly inspectable subject: no blur, no artificial glow, no people. The LEFT 48 percent is almost empty, naturally lit pale cool-gray tabletop negative space for black webpage text, with just one fine loose dark thread crossing at the lower left. Camera slightly above table, real cloth folds and small honest imperfections, soft daylight, calm art-directed contemporary circular design publication, crisp high-resolution textile detail. Palette primarily indigo, faded blue, white, muted sage, tiny natural warm neutral accents, no dominant beige. The composition is an integrated edge-to-edge photograph, not separate panels. No text, labels, logos, branding, watermark, gradients, frames, graphics, UI, plant decorations, or mockup."
- `src/assets/public/baliktelaph.png`, `dost.jpg`, `pchrd.png`, and `national-university.png` are size-optimized derivatives of the owner-supplied logos described below. No marks or watermarks were removed. Logo order remains DOST, PCHRD, National University, with BalikTelaPH as the site's main identity.
- The supporting material photograph reuses `src/assets/auth/textile-study.jpg`, credited below.
- Project descriptions and the mobile/web role distinction follow the owner's finalized `Documents/Balik Tela PH Web and Mobile Blueprint.docx`. Prospective organizations are not presented as partners; synthetic analytics are not presented as public impact results.
- The mobile destination `https://baliktelaprogressive.vercel.app/` was supplied by the project owner and returned HTTP 200 on October 16, 2026. It is linked as the mobile web experience, not as an Android/iOS store download.
- Editorial composition and restrained hierarchy draw on [Taste Skill](https://github.com/Leonxlnx/taste-skill) and [Awesome Design.md](https://github.com/VoltAgent/awesome-design-md); accessibility and short, reduced-motion-aware transitions draw on [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) and [Design Motion Principles](https://github.com/kylezantos/design-motion-principles). These are references, not installed instructions or copied templates.
- The public educational link points to the [Ellen MacArthur Foundation's circular fashion overview](https://www.ellenmacarthurfoundation.org/topics/fashion/overview). No external statistics or impact figures have been copied.

- `philippines-map.png`: "Philippines-map-blank.png", CIA World Factbook via Wikimedia Commons. Public domain. https://commons.wikimedia.org/wiki/File:Philippines-map-blank.png

## Geographic Insights

- `src/assets/maps/philippines-context.geo.json`: Natural Earth 1:50m country geometry, reduced to the Philippines and nearby context countries. Source revision `ca96624a56bd078437bca8184e78163e5039ad19`: https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_50m_admin_0_countries.geojson
- `src/assets/maps/regional-anchors.json`: Natural Earth populated-place coordinates for Manila, Cebu, Iloilo, and Davao. These are indicative regional reference locations, not participant addresses or surveyed facility locations. Same source revision: https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_populated_places.geojson
- Natural Earth data is public domain: https://www.naturalearthdata.com/about/terms-of-use/
- Leaflet handles map projection, pan, zoom, and markers. Geometry is bundled locally; the map does not require external tile services, an API key, or participant-location data. https://leafletjs.com/

The geographic redesign adapts hierarchy and domain-specific presentation from [Taste Skill](https://github.com/Leonxlnx/taste-skill), accessible controls and responsive layout from [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), purposeful reduced-motion-aware transitions from [Design Motion Principles](https://github.com/kylezantos/design-motion-principles), and restrained operational surfaces from [Awesome Design.md](https://github.com/VoltAgent/awesome-design-md). These are references, not copied templates or installed agent instructions.

## Authentication logos

The project owner supplied these existing assets from the project's `Documents` folder. They are copied unchanged into `src/assets/auth`; their inclusion does not assert a new endorsement or license.

- `dost.jpg`: `DOST.jpg`. The supplied JPG includes a checkerboard background and watermark; neither has been removed. Replace with a clean authorized master when available.
- `pchrd.png`: `DOST-PCHRD.png`.
- `national-university.png`: `NU-H-Blue (46).png`, the horizontal blue lockup for light surfaces. CSS frames the artwork's empty margins without changing the logo pixels.
- `baliktelaph.png`: `BalikTelaPh Logo.png`.

BalikTelaPH is the main authentication header logo. Footer display order: DOST, PCHRD, National University. Original colors and proportions are preserved.

## Authentication material study

- `src/assets/auth/textile-study.jpg`: original AI-generated illustrative textile photograph, made with the built-in image generation tool on October 15, 2026. It does not depict a real partner facility. Converted from the generated PNG to JPEG for delivery; the original remains in the local generated-images archive.
- Generation prompt: "Use case: photorealistic-natural. Asset type: original photographic background for the right-hand image region of the BalikTelaPH institutional authentication page, not a UI screenshot. Create a premium, tactile editorial photograph of circular textile materials: clean washed indigo denim offcuts, soft white and pale-gray cotton, a small muted forest-green fabric piece and a restrained terracotta-red textile edge, thoughtfully gathered on a light cool-gray work surface. Show recognizably real fibers, stitched hems, cut edges, and convincing fabric folds, not abstract plastic ribbons. Portrait composition approximately 4:5, close overhead/oblique view, materials fill most of the frame with a quiet upper area and a clear diagonal arrangement. Bright diffused daylight, accurate natural colors, refined research/material-library mood. Deep indigo and neutral whites provide the main contrast; no dominant beige or brown, no cinematic darkness, no gradients or decorative haze. No people, hands, machines, plants, icons, logos, lettering, badges, watermark, charts, containers, UI, or text. This is an illustrative material study, not a photograph of a real named facility. Produce a beautiful finished bitmap suitable for a full-height unframed photograph beside a clean white sign-in form."

Authentication design references (adapted, not copied or installed): [Taste Skill](https://github.com/Leonxlnx/taste-skill), [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), [Design Motion Principles](https://github.com/kylezantos/design-motion-principles), [Design.md](https://github.com/jeftarmascarenhas/design.md), and the previously supplied [Awesome Design.md](https://github.com/VoltAgent/awesome-design-md). The implementation keeps the existing React/shadcn components and uses CSS-only, reduced-motion-aware transitions.
