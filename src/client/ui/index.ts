// The component library of the app. Hand-built, styled by classes and CSS variables (ui.css), no `t` prop: the colours follow the theme.
// Import from here: `import { Button, Dialog } from '../ui';`

export { Avatar, type AvatarSize } from './Avatar';
export { Badge, type BadgeTone } from './Badge';
export { Banner, type BannerTone } from './Banner';
export { Button, type ButtonProps, type ButtonVariant, type ControlSize } from './Button';
export { Card, Section } from './Card';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { Chip, type ChipColors, type ChipProps } from './Chip';
export { CodeBlock } from './CodeBlock';
export { CopyButton, type CopyButtonProps, type CopyResult } from './CopyButton';
export { Dialog, type DialogProps } from './Dialog';
/** Disclosure: the button that shows or hides a region; DisclosurePanel: that region, whose height opens with it (grid rows). */
export { Disclosure, DisclosurePanel, type DisclosurePanelProps, type DisclosureProps } from './Disclosure';
export { Divider } from './Divider';
export { EmptyState } from './EmptyState';
export { Field } from './Field';
export { IconButton, type IconButtonProps } from './IconButton';
export { Kbd } from './Kbd';
export { Menu, type MenuItem, type MenuProps, type MenuTriggerProps } from './Menu';
export { Popover, type PopoverProps } from './Popover';
export { RadioGroup, type RadioGroupProps, type RadioOption } from './RadioGroup';
export { SecretBox, type SecretBoxProps } from './SecretBox';
export { SegmentedControl, type SegmentedControlProps, type SegmentOption } from './SegmentedControl';
export { Select, type SelectOption, type SelectProps } from './Select';
export { Skeleton } from './Skeleton';
export { ListSkeleton, TableSkeleton } from './SkeletonRows';
export { Spinner } from './Spinner';
export { Step, Steps } from './Steps';
export { Switch, type SwitchProps } from './Switch';
export { Table, type TableProps } from './Table';
export { TabPanel, Tabs, type Tab, type TabsProps } from './Tabs';
export { TextArea, TextField, type TextAreaProps, type TextFieldProps } from './TextField';
/** A row of controls that is one Tab stop, with arrow keys between them (ARIA toolbar): the reader's actions, compose's formatting tools. */
export { Toolbar, type ToolbarProps } from './Toolbar';
/**
 * Tooltip: the bubble; useTooltip: its show/hide rules (a 500 ms rest of the mouse, at once on keyboard focus, a grace to reach the bubble,
 * Escape anywhere: 1.4.13; spread `anchor` on the control: onPointerEnter, onPointerMove, onPointerLeave).
 */
export { Tooltip, TOOLTIP_OPEN_DELAY_MS, useTooltip } from './Tooltip';
/**
 * Drag-to-dismiss for a sheet (Dialog uses it on phones) or a drawer: `useSwipeToDismiss(ref, { direction: 'down' | 'left', onDismiss })`.
 * Closes past 30% of the size or on a flick, settles back otherwise; give the drag area `touch-action: none` (or `pan-y` on a drawer).
 */
export { pressedOnControl, useSwipeToDismiss, type SwipeDirection, type SwipeToDismissOptions } from './useSwipeToDismiss';
export { VisuallyHidden } from './VisuallyHidden';
/**
 * The v3 "Airmail" signature (DESIGN-v3 section 3): homing flights of messages to their folder (`registerHome`, `flyHome`, `catchHome`,
 * `foldAndFly`), rolling counts (`Odometer`), the gliding selection capsule (`useGlide`), the flight trail illustration (`FlightTrail`)
 * and the date-time picker that replaces the browser's (`DateTimePicker`). Every motion honours `motionReduced()`.
 */
export {
  catchHome,
  flyFrom,
  flyHome,
  foldAndFly,
  homeElement,
  homeRef,
  registerHome,
  type FlyHomeOptions,
  type FoldOptions,
  type HomeId,
  type HomingKind
} from './homing';
export { Odometer, type OdometerProps } from './Odometer';
export { useGlide, type GlideOptions } from './glide';
export { FlightTrail, type FlightTrailProps } from './FlightTrail';
/** Postmark: a decorative circular date stamp with wavy cancellation lines (the reader's open letter, compose at Send); aria-hidden. */
export { Postmark, type PostmarkProps } from './Postmark';
export { DateTimePicker, type DateTimePickerProps } from './DateTimePicker';
/**
 * Layout as state (ui/media.ts): `useMediaMatch(query)` (a media query, false on the server), `useOverflows(ref)` (whether a scroll area
 * scrolls: its Tab stop), `useScrollEdges(ref, on)` (`data-more` on the hidden side of a sideways scroller, for an edge fade).
 */
export { useMediaMatch, useOverflows, useScrollEdges } from './media';
/**
 * Motion helpers (ui/motion.ts). `motionReduced()` / `useMotionReduced()`: the system setting or the in-app choice (`data-motion="reduce"`),
 * read by every JS motion. `durationFor(px)` and `exitDuration(ms)`: the distance rule and the 0.7 exit rule. `leaveRow(el, dir)` (M1: a
 * message leaves the list), `enterRow(el)` (Undo, new mail), `flip(container)` (bulk moves), `useExitMotion(ref, kind)` (a layer leaves on
 * an inert copy), `leaveInPlace(el)` (a bar gives its place back: the selection bar). Each one changes nothing but pixels: data and focus
 * move at once, before or without waiting for it. Compose's own motion
 * (M10 open/close, M11 the send flight) lives with compose (components/compose/composeMotion.ts).
 */
export {
  durationFor,
  enterRow,
  exitDuration,
  flip,
  leaveInPlace,
  leaveRow,
  motionReduced,
  useExitMotion,
  useMotionReduced,
  type ExitKind
} from './motion';
