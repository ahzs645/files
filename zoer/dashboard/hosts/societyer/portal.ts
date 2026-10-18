/**
 * Where Societyer-styled dialogs portal to. They must stay inside the `.bcbid-native` scope root so the plugin's
 * scoped CSS and the host's `--zoer-*` colours still apply; native `<dialog>` top-layer stacking keeps them above
 * Societyer's own chrome wherever they sit in the tree.
 */
let mountElement: HTMLElement | null = null;
export function setPortalRoot(element: HTMLElement) {
  mountElement = element;
  return () => { if (mountElement === element) mountElement = null; };
}
export const portalRoot = () => mountElement?.querySelector<HTMLElement>('.bcbid-native') ?? mountElement ?? document.body;
