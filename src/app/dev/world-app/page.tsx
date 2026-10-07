/**
 * The map is drawn by WorldStage in the layout, so this route renders nothing
 * (the same as src/app/world/page.tsx). It exists so /dev/world-app is an
 * address the harness can land on and return to.
 */
export default function WorldAppPage() {
  return null;
}
