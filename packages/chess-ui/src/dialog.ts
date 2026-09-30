/**
 * Below 640px a full-screen sheet; from 640px Macaw's centred dialog, kept inside the viewport.
 * Macaw's `cn` lets these win over its fixed width, `100vh` height and centring transform.
 */
export const DIALOG_CLASSES = [
  "inset-0 left-0 top-0 h-[100dvh] max-h-[100dvh] w-screen translate-x-0 translate-y-0 rounded-none",
  "pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]",
  "sm:bottom-auto sm:left-[50%] sm:right-auto sm:top-[50%] sm:h-auto sm:max-h-[calc(100dvh-1rem)] sm:w-[min(37.5rem,calc(100vw-1rem))] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:p-0",
].join(" ");

/** The content wrapper: a column whose body scrolls between a fixed header and footer. */
export const REGION_CLASSES = "flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-0";
