export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerInput {
  forward: number;
  back: number;
  turn: number;
}

export interface PlayerState {
  position: Vec3;
  yaw: number;
  verticalVelocity: number;
  grounded: boolean;
}

export interface MovementResult {
  translation: Vec3;
  grounded: boolean;
}

export interface HeightSampler {
  sample(x: number, z: number): number;
}

export interface FixedStepEvent {
  dt: number;
  input: PlayerInput;
  state: PlayerState;
}
