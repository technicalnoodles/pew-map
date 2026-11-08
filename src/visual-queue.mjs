// Keep the newest visual samples when input outpaces animation, without reordering them.
export function enqueueVisuals(queue, incoming, limit) {
  const ordered = [...incoming].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  return queue.concat(ordered).slice(-limit);
}
