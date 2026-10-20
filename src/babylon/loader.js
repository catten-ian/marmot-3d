import { SceneLoader } from '@babylonjs/core';
// Register the glTF/GLB loader with Babylon's SceneLoader.
import '@babylonjs/loaders';

const SOFT_TIMEOUT_MS = 15000;

/**
 * Load a GLB into a Babylon AssetContainer without adding it to the scene.
 * The caller decides when and where the container is attached.
 */
export async function loadBabylonGLB(scene, url) {
  const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
  const fileName = url.substring(url.lastIndexOf('/') + 1);

  const container = await SceneLoader.LoadAssetContainerAsync(
    baseUrl,
    fileName,
    scene,
    null,
    '.glb',
  );

  return {
    container,
    rootName: container.rootNodes[0]?.name,
    meshCount: container.meshes.length,
  };
}

/** Preload the game's GLB assets independently so one failure does not stop the others. */
export async function preloadGameModelsBabylon(scene, paths) {
  const out = {};
  for (const [key, url] of Object.entries(paths)) {
    try {
      out[key] = await loadBabylonGLB(scene, url);
      console.log(`[babylon-loader] ok: ${key} -> ${url} (root=${out[key].rootName}, meshes=${out[key].meshCount})`);
    } catch (e) {
      console.error(`[babylon-loader] fail: ${key} -> ${url}`, e);
      out[key] = null;
    }
  }
  return out;
}

/** Add an AssetContainer's contents to the scene, optionally under a parent node. */
export function addContainerToScene(container, parent) {
  if (parent) container.addAllToScene(parent);
  else container.addAllToScene();
}

