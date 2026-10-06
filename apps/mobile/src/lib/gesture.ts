/**
 * One flag shared between horizontal carousels and the tab-swipe gesture:
 * while a finger is on a carousel, the tabs do not move. Without this a
 * scroll through the deals strip reads as "go to the next window".
 */
let carouselTouches = 0;

export const carouselBusy = (): boolean => carouselTouches > 0;

/** Spread onto any horizontal ScrollView that lives inside the tab pager. */
export const carouselProps = {
  onTouchStart: () => { carouselTouches += 1; },
  onTouchEnd: () => { carouselTouches = Math.max(0, carouselTouches - 1); },
  onTouchCancel: () => { carouselTouches = Math.max(0, carouselTouches - 1); },
  onScrollEndDrag: () => { carouselTouches = 0; },
  onMomentumScrollEnd: () => { carouselTouches = 0; },
} as const;
