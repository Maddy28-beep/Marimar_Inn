# Christmas presentation layer

This change is frontend-only. Firebase code, security rules, authentication,
business calculations, routes, and Android source are unchanged.

## Where it lives

- `src/app/christmas.css`: seasonal palette, shared component treatments,
  room accents, responsive rules, and animation keyframes.
- `src/components/christmas/christmas-effects.tsx`: decorative lights,
  snow, motion control, and Santa's visit schedule and SVG.
- Root layout: stylesheet import and `data-season="christmas"` on the body.
- Authenticated layout: `ChristmasEffects` wrapper, garland, navigation styles.
- Dashboard: seasonal welcome; room grid: non-interactive Santa overlay.
- Login: seasonal colors and greeting. All original sign-in behavior remains.

## Older tablet performance

- No new dependencies, images, animation framework, canvas, or frame callbacks.
- Room/store card backdrop blur removed; surfaces use static gradients.
- Seven small snow particles (four on narrow screens); lights animate opacity.
- Santa is a single small SVG, mounted only during an 18-second visit. The
  first visit starts after 9–15 seconds; subsequent visits have 65–115-second
  gaps. Direction and greeting vary. Travel, limbs, and particles use CSS
  transforms and opacity.
- Timers and effects stop when the page is hidden or reduced motion is enabled.
- Header's **Pause festive motion** control also stops the existing animated
  room-status icons. Normal hotel controls stay active.
- Decorations ignore pointer events, are hidden from accessibility APIs, and
  are omitted when printing.

Browser previews verify layout, not the speed of a particular physical tablet.
Use the pause control if a device struggles; the static theme remains intact.

## Removing after the season

Remove the `christmas.css` import and `data-season` attribute from the root
layout; unwrap `ChristmasEffects` and remove `ChristmasGarland` from the app
layout; remove `SantaRunner` from the room grid. Restore the welcome/login
copy if desired. Seasonal class names can then be removed along with the
stylesheet and decorative component file. Retaining the corrected Geist font
reference, wrapping mobile toolbar, and blur-free cards is recommended.

## Validation

The visual preview used temporary sample data and real shared UI components;
no hotel records were created or changed. The temporary preview route was
removed. Desktop, tablet, mobile, modal styling, Santa, pointer-event behavior,
and the motion pause control were inspected in the browser.
