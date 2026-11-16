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
- Three small Santa SVGs appear immediately across the first room rows. Each
  walks back and forth on a 26-second CSS cycle, with staggered positions and
  different greetings. Travel, limbs, and particles use transforms and opacity;
  there are no scheduling timers or JavaScript animation loops.
- Effects stop when the page is hidden or reduced motion is enabled.
- On phones, the three Santas use a compact lane above the cards, with one
  third of its width per character. They cannot overlap or cover room details.
  Reduced motion keeps the Santas visible but stationary; the pause control
  can hide them entirely.
- **Enable festive motion** explicitly enables animation even when the device
  requests reduced motion. The user's on/off choice is saved on this device
  and restored after reloads. Until a choice is made, the system preference
  is honored. Hidden pages always stop animation.
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
