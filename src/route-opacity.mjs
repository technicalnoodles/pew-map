// Fade route graphics at their boundaries without changing projectile timing.
export function routeOpacity(now, createdAt, expiresAt, fadeInMs = 180, fadeOutMs = 320, startOpacity = 0) {
  const fadeIn = startOpacity + (1 - startOpacity) * Math.max(0, (now - createdAt) / fadeInMs);
  return Math.max(0, Math.min(1, fadeIn, (expiresAt - now) / fadeOutMs));
}

export function extendRoute(route, now, duration) {
  route.startOpacity = routeOpacity(now, route.createdAt, route.expiresAt, 180, 320, route.startOpacity);
  route.createdAt = now;
  route.expiresAt = now + duration;
}
