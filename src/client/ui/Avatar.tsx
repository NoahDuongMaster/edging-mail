import React from 'react';
import { cx } from './cx';
import { initialsOf, isCjk } from './initials';

/** The named sizes in px: xs 24, sm 28, md 32, lg 40, xl 56. A number is any other size in px (a list row's 36, a reader header's 44). */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;

interface AvatarProps {
  /** The person's name or address; the letters are made from it. */
  name: string;
  /** 24, 28, 32, 40 or 56 px, or a number of px. Default: 32. */
  size?: AvatarSize;
  /** The person of the open (selected) row, or the signed-in person: the tile takes the accent tint instead of the neutral fill. */
  selected?: boolean;
  /**
   * The person's own hue (a `LABEL_HUES` slot, e.g. `labelHue(address)` from theme.ts): a soft tint of it for the tile and a deep (light) or
   * pale (dark) shade of it for the initials, 6.4:1 or more for every slot in both themes. Without it, one quiet neutral tile.
   */
  hue?: string;
  /**
   * 'circle' (default): the signed-in person, people in the admin console. 'stamp' (v3 signature): the people who write to you (a message
   * row, the reader's sender, a recipient chip) are postage stamps with perforated edges and a printed field in their tint.
   */
  shape?: 'circle' | 'stamp';
  /**
   * The person's picture (a same-origin URL, `avatarUrl` in lib/avatar.ts: one this server has, uploaded by the person or, for a sender from
   * outside, looked up by the server when an admin allowed it; the browser never asks a third party): it fills the tile, cut to the tile's
   * own shape (the circle, or inside the printed field of a stamp), over the initials. The initials stay underneath: until the picture has
   * loaded, and for good when it fails (no broken-image mark, no jump, and it is asked for once, never again by this tile).
   */
  src?: string;
  className?: string;
}

/** What the tile has learned about the address it was given: that picture loaded, or failed. */
export type PictureSeen = { src: string; status: 'loaded' | 'failed' } | null;

/**
 * The picture to draw and how it went: nothing to draw for no address or for an address that failed (the initials stay, and the browser is not
 * asked again); what was seen about ANOTHER address says nothing (a tile reused for a new picture starts over).
 */
export function pictureState(
  src: string | undefined,
  seen: PictureSeen
): { picture: string | undefined; status: 'loaded' | 'failed' | undefined } {
  const wanted = src === undefined || src === '' ? undefined : src;
  const status = wanted !== undefined && seen?.src === wanted ? seen.status : undefined;
  return { picture: status === 'failed' ? undefined : wanted, status };
}

/**
 * The size of the letters for a size in px: two Latin letters at about 40 % of the circle, one CJK character a step larger; a stamp's printed
 * field is the tile minus its teeth, so its letters are a little over a third of the tile.
 */
const letterSize = (px: number, cjk: boolean, stamp: boolean): number => Math.round(px * (stamp ? (cjk ? 0.42 : 0.36) : cjk ? 0.46 : 0.39));

/**
 * A round tile with a person's initials: one quiet neutral for everybody by default, or the person's own soft tint (`hue`), so a list of
 * senders reads at a glance; the sender of the open message and the signed-in person take the accent tint (`selected`). It is decoration:
 * the name is always written next to it or in the label of the control it sits in, so screen readers skip it. A CJK name shows one
 * character, a size larger (`data-script="cjk"`; ui/initials.ts). With a `src` the picture is decoration too: the picture has no text
 * alternative, because the name beside it already says who it is.
 */
export function Avatar({ name, size = 'md', selected = false, hue, shape = 'circle', src, className }: AvatarProps): React.ReactElement {
  // How the picture went, for ONE address: a tile that is given another picture (a new id) starts over; a failed one is not asked for again.
  const [seen, setSeen] = React.useState<PictureSeen>(null);
  const { picture, status } = pictureState(src, seen);
  const initials = initialsOf(name);
  const cjk = isCjk(initials);
  const px = typeof size === 'number' ? size : undefined;
  const tinted = hue !== undefined && hue !== '';
  const style: Record<string, string> = {};
  if (tinted) {
    style['--ui-hue'] = hue;
  }
  if (px !== undefined) {
    style['--ui-avatar-size'] = `${px}px`;
    style.fontSize = `${letterSize(px, cjk, shape === 'stamp')}px`;
  }
  return (
    <span
      className={cx('ui-avatar', className)}
      data-size={px === undefined ? size : 'custom'}
      data-shape={shape === 'stamp' ? 'stamp' : undefined}
      data-hue={tinted ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-script={cjk ? 'cjk' : undefined}
      data-image={picture === undefined ? undefined : status === 'loaded' ? 'loaded' : 'loading'}
      style={Object.keys(style).length > 0 ? style : undefined}
      aria-hidden="true"
    >
      {initials}
      {picture === undefined ? null : (
        <img
          className="ui-avatar-img"
          src={picture}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setSeen({ src: picture, status: 'loaded' })}
          onError={() => setSeen({ src: picture, status: 'failed' })}
        />
      )}
    </span>
  );
}
