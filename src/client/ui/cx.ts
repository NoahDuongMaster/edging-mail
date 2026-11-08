/** Joins class names and leaves out the ones that are false, null or empty: `cx('ui-btn', big && 'ui-btn-big', className)`. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter((name) => name !== undefined && name !== null && name !== false && name !== '').join(' ');
}
