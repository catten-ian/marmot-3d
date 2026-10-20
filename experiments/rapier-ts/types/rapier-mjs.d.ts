declare module "*.mjs" {
  const RAPIER: typeof import("../vendor/@dimforge/rapier3d-compat/dist/rapier").default;
  export default RAPIER;
}
