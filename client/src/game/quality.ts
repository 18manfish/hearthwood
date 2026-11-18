// Renderer settings by class of device.
//
// Phones and tablets have many small pixels and a weak GPU: anti-aliasing and a pixel
// ratio above 1.5 cost a lot there and show little, and a 2048² soft shadow map is
// more than they need. Everything else gets the full picture; if that turns out too
// much for a machine, the dynamic resolution (environment.ts) takes over.
//
// Only the kind of device counts. Core counts and memory sizes are not used: browsers
// with fingerprinting protection (LibreWolf, Tor…) report made-up small values.

export interface Quality {
  mobile: boolean;
  antialias: boolean;
  maxPixelRatio: number;
  shadowMapSize: number;
  softShadows: boolean;
}

export function pickQuality(): Quality {
  const ua = navigator.userAgent;
  // (iPadOS calls itself a Mac; a Mac with several touch points is an iPad)
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return mobile
    ? { mobile, antialias: false, maxPixelRatio: 1.5, shadowMapSize: 1024, softShadows: false }
    : { mobile, antialias: true, maxPixelRatio: 2, shadowMapSize: 2048, softShadows: true };
}
