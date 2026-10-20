import assert from "node:assert/strict";
import test from "node:test";
import RAPIER from "../vendor/@dimforge/rapier3d-compat/dist/rapier.mjs";

test("Rapier initializes offline and settles a capsule with a fixed timestep", async () => {
  await RAPIER.init();
  assert.equal(RAPIER.version(), "0.21.0");

  const fixedDt = 1 / 60;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = fixedDt;
  assert.ok(Math.abs(world.timestep - fixedDt) < 1e-7);

  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const flatHeightfield = new Float32Array((5 + 1) * (5 + 1));
  world.createCollider(
    RAPIER.ColliderDesc.heightfield(5, 5, flatHeightfield, new RAPIER.Vector3(8, 1, 8)),
    staticBody,
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 1, 4.4).setTranslation(-4.2, 1, 0), staticBody);
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 1, 4.4).setTranslation(4.2, 1, 0), staticBody);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.1, 0),
  );
  const capsule = world.createCollider(RAPIER.ColliderDesc.capsule(0.45, 0.35), body);
  const controller = world.createCharacterController(0.02);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.enableSnapToGround(0.2);

  const step = (desired) => {
    controller.computeColliderMovement(capsule, desired);
    const movement = controller.computedMovement();
    const current = body.translation();
    body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });
    world.step();
    return controller.computedGrounded();
  };

  let grounded = false;
  for (let i = 0; i < 120; i += 1) {
    grounded = step({ x: 0, y: -9.81 * fixedDt, z: 0 });
  }
  const settled = body.translation();
  assert.equal(grounded, true);
  assert.ok(settled.y > 0.7 && settled.y < 1.0, `unexpected settled y=${settled.y}`);

  for (let i = 0; i < 100; i += 1) {
    step({ x: 0.1, y: -0.02, z: 0 });
  }
  const bounded = body.translation();
  assert.ok(bounded.x < 3.7, `capsule crossed boundary at x=${bounded.x}`);
  assert.ok(bounded.x > 3.0, `capsule did not reach boundary at x=${bounded.x}`);

  controller.free();
  world.free();
});
