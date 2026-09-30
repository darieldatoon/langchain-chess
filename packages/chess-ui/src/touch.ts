/**
 * At least 44×44px on a coarse pointer. Macaw's largest control is 40px, so every tappable
 * control takes this class.
 */
export const TOUCH_TARGET = "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11";

/** The same 44px hit area for an inline trigger smaller than that, without changing its layout. */
export const TOUCH_HIT_AREA =
  "relative [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:left-1/2 [@media(pointer:coarse)]:after:top-1/2 [@media(pointer:coarse)]:after:size-11 [@media(pointer:coarse)]:after:-translate-x-1/2 [@media(pointer:coarse)]:after:-translate-y-1/2 [@media(pointer:coarse)]:after:content-['']";
