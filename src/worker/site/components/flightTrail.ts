/**
 * The v3 flight trail (the app's FlightTrail in src/client/ui, drawn still): a dashed arc that takes off from behind something and curves
 * away to the right, and a small airmail letter (paper, the red, paper, blue, paper edge of the airmail band, the flap) turned along its
 * end. Decoration only (`aria-hidden`); nothing on the page moves, so it has no draw-in. The colours come from CSS (`.trail`: the arc in
 * the accent at a low alpha through currentColor, the letter's paper --surface, its stripes --airmail-red and --accent). In the hero the arc
 * starts behind the product window and crosses its top edge steeply, so the letter visibly leaves the app. `className` places it.
 */
export function flightTrail(className: string): string {
  // The arc is written from the letter back to its origin, so the dash pattern starts at the letter (a full dash meets it).
  const arc = 'M140 36 C90 45 40 95 10 150';
  // The striped edge: a 24 x 16 frame is 80 units round, ten periods of red 3, paper 1, blue 3, paper 1, so every corner turns on the
  // same step; the flap starts inside it.
  const edge = 'x="-12" y="-8" width="24" height="16"';
  const flap = 'M-9 -5 L0 1 L9 -5';
  return `<svg class="trail ${className}" aria-hidden="true" focusable="false" width="180" height="150" viewBox="0 0 180 150" fill="none"><path class="trail-arc" d="${arc}" stroke-dasharray="3 5"/><g transform="translate(158 33) rotate(-10)"><rect class="trail-paper" x="-14" y="-10" width="28" height="20" rx="3"/><rect class="trail-stripe-a" ${edge} stroke-dasharray="3 5"/><rect class="trail-stripe-b" ${edge} stroke-dasharray="3 5" stroke-dashoffset="-4"/><path class="trail-flap" d="${flap}"/></g></svg>`;
}
