import type { MovementResult, PlayerInput, PlayerState, Vec3 } from "./types.js";

export type MovementResolver = (desiredTranslation: Vec3) => MovementResult;

export interface PlayerControllerOptions {
  moveSpeed?: number;
  turnSpeed?: number;
  gravity?: number;
}

/** Input and locomotion policy, independent from Rapier and any renderer. */
export class PlayerController {
  private readonly moveSpeed: number;
  private readonly turnSpeed: number;
  private readonly gravity: number;
  private state: PlayerState;

  public constructor(options: PlayerControllerOptions = {}) {
    this.moveSpeed = options.moveSpeed ?? 3;
    this.turnSpeed = options.turnSpeed ?? 2.4;
    this.gravity = options.gravity ?? -9.81;
    this.state = {
      position: { x: 0, y: 1, z: 0 },
      yaw: 0,
      verticalVelocity: 0,
      grounded: false,
    };
  }

  public getState(): PlayerState {
    return {
      ...this.state,
      position: { ...this.state.position },
    };
  }

  public step(input: PlayerInput, dt: number, resolveMovement: MovementResolver): PlayerState {
    if (!(dt > 0) || !Number.isFinite(dt)) {
      throw new RangeError("fixed timestep must be a finite positive number");
    }

    const forwardAxis = clamp(input.forward - input.back, -1, 1);
    const turnAxis = clamp(input.turn, -1, 1);
    this.state.yaw += turnAxis * this.turnSpeed * dt;

    if (this.state.grounded && this.state.verticalVelocity < 0) {
      this.state.verticalVelocity = -1;
    }
    this.state.verticalVelocity += this.gravity * dt;

    const direction = { x: Math.sin(this.state.yaw), z: Math.cos(this.state.yaw) };
    const desiredTranslation = {
      x: direction.x * forwardAxis * this.moveSpeed * dt,
      y: this.state.verticalVelocity * dt,
      z: direction.z * forwardAxis * this.moveSpeed * dt,
    };
    const result = resolveMovement(desiredTranslation);
    this.state.position = {
      x: this.state.position.x + result.translation.x,
      y: this.state.position.y + result.translation.y,
      z: this.state.position.z + result.translation.z,
    };
    this.state.grounded = result.grounded;
    if (result.grounded && this.state.verticalVelocity < 0) {
      this.state.verticalVelocity = 0;
    }
    return this.getState();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
