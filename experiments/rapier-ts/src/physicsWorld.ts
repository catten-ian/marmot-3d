import RAPIER from "../vendor/@dimforge/rapier3d-compat/dist/rapier.mjs";
import type * as Rapier from "../vendor/@dimforge/rapier3d-compat/dist/rapier";
import { createDemoHeightfield, type HeightfieldDefinition } from "./heightfieldAdapter.js";
import { PlayerController } from "./playerController.js";
import type { FixedStepEvent, PlayerInput, PlayerState, Vec3 } from "./types.js";

export interface RapierSliceOptions {
  fixedDt?: number;
  heightfield?: HeightfieldDefinition;
}

export class RapierSliceWorld {
  public readonly fixedDt: number;
  public readonly heightfield: HeightfieldDefinition;
  public readonly rapier = RAPIER;
  public readonly world: Rapier.World;
  public readonly playerBody: Rapier.RigidBody;
  public readonly playerCollider: Rapier.Collider;

  private readonly characterController: Rapier.KinematicCharacterController;
  private readonly playerController: PlayerController;

  private constructor(fixedDt: number, heightfield: HeightfieldDefinition) {
    this.fixedDt = fixedDt;
    this.heightfield = heightfield;
    this.world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
    this.world.timestep = fixedDt;
    this.world.numSolverIterations = 4;

    const groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const ground = RAPIER.ColliderDesc.heightfield(
      heightfield.nrows,
      heightfield.ncols,
      heightfield.heights,
      new RAPIER.Vector3(heightfield.scale.x, heightfield.scale.y, heightfield.scale.z),
    );
    this.world.createCollider(ground, groundBody);
    this.addBoundaryColliders(groundBody);

    this.playerBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0),
    );
    this.playerCollider = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.45, 0.35), this.playerBody);
    this.characterController = this.world.createCharacterController(0.02);
    this.characterController.setUp(new RAPIER.Vector3(0, 1, 0));
    this.characterController.setMaxSlopeClimbAngle(Math.PI / 3);
    this.characterController.enableSnapToGround(0.2);
    this.playerController = new PlayerController();
  }

  public static async create(options: RapierSliceOptions = {}): Promise<RapierSliceWorld> {
    await RAPIER.init();
    const fixedDt = options.fixedDt ?? 1 / 60;
    if (!(fixedDt > 0) || !Number.isFinite(fixedDt)) {
      throw new RangeError("fixedDt must be a finite positive number");
    }
    return new RapierSliceWorld(fixedDt, options.heightfield ?? createDemoHeightfield());
  }

  public step(input: PlayerInput): FixedStepEvent {
    let movement: Vec3 = { x: 0, y: 0, z: 0 };
    let grounded = false;
    const state = this.playerController.step(input, this.fixedDt, (desiredTranslation) => {
      this.characterController.computeColliderMovement(
        this.playerCollider,
        new RAPIER.Vector3(desiredTranslation.x, desiredTranslation.y, desiredTranslation.z),
      );
      const computed = this.characterController.computedMovement();
      movement = { x: computed.x, y: computed.y, z: computed.z };
      grounded = this.characterController.computedGrounded();
      const current = this.playerBody.translation();
      this.playerBody.setNextKinematicTranslation(
        new RAPIER.Vector3(current.x + movement.x, current.y + movement.y, current.z + movement.z),
      );
      return { translation: movement, grounded };
    });
    this.world.step();
    return { dt: this.fixedDt, input: { ...input }, state };
  }

  public getPlayerState(): PlayerState {
    return this.playerController.getState();
  }

  public free(): void {
    this.characterController.free();
    this.world.free();
  }

  private addBoundaryColliders(groundBody: Rapier.RigidBody): void {
    const wall = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
      const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z);
      this.world.createCollider(desc, groundBody);
    };
    wall(-4.2, 1, 0, 0.2, 1, 4.4);
    wall(4.2, 1, 0, 0.2, 1, 4.4);
    wall(0, 1, -4.2, 4.4, 1, 0.2);
    wall(0, 1, 4.2, 4.4, 1, 0.2);
  }
}
