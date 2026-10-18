// Entities live in one Int32Array (stride ENT_STRIDE) so the whole object list can be snapshotted, diffed and
// restored with typed-array copies. The Entity class is a view with C-like field semantics: byte fields wrap at
// 256, controlMode is a signed byte, groupID an unsigned short, exactly as in the original struct.

export const ENT_STRIDE = 96;

export const enum F {
  xpos = 0,
  ypos = 1,
  xvel = 2,
  yvel = 3,
  speed = 4,
  values = 5, // 48 ints
  state = 53,
  angle = 54,
  scale = 55,
  rotation = 56,
  alpha = 57,
  animationTimer = 58,
  animationSpeed = 59,
  lookPosX = 60,
  lookPosY = 61,
  groupID = 62,
  type = 63,
  propertyValue = 64,
  priority = 65,
  drawOrder = 66,
  direction = 67,
  inkEffect = 68,
  animation = 69,
  prevAnimation = 70,
  frame = 71,
  collisionMode = 72,
  collisionPlane = 73,
  controlMode = 74,
  controlLock = 75,
  pushing = 76,
  visible = 77,
  tileCollisions = 78,
  objectInteractions = 79,
  gravity = 80,
  left = 81,
  right = 82,
  up = 83,
  down = 84,
  jumpPress = 85,
  jumpHold = 86,
  scrollTracking = 87,
  floorSensors = 88, // 5 bytes
}

export class Entity {
  readonly o: number;
  readonly values: Int32Array;
  /** Byte array semantics: write through setFloorSensor. Reads are plain. */
  readonly floorSensors: Int32Array;

  constructor(
    readonly m: Int32Array,
    readonly slot: number,
  ) {
    this.o = slot * ENT_STRIDE;
    this.values = m.subarray(this.o + F.values, this.o + F.values + 48);
    this.floorSensors = m.subarray(this.o + F.floorSensors, this.o + F.floorSensors + 5);
  }

  get xpos() { return this.m[this.o]; }
  set xpos(v: number) { this.m[this.o] = v; }
  get ypos() { return this.m[this.o + 1]; }
  set ypos(v: number) { this.m[this.o + 1] = v; }
  get xvel() { return this.m[this.o + 2]; }
  set xvel(v: number) { this.m[this.o + 2] = v; }
  get yvel() { return this.m[this.o + 3]; }
  set yvel(v: number) { this.m[this.o + 3] = v; }
  get speed() { return this.m[this.o + 4]; }
  set speed(v: number) { this.m[this.o + 4] = v; }
  get state() { return this.m[this.o + 53]; }
  set state(v: number) { this.m[this.o + 53] = v; }
  get angle() { return this.m[this.o + 54]; }
  set angle(v: number) { this.m[this.o + 54] = v; }
  get scale() { return this.m[this.o + 55]; }
  set scale(v: number) { this.m[this.o + 55] = v; }
  get rotation() { return this.m[this.o + 56]; }
  set rotation(v: number) { this.m[this.o + 56] = v; }
  get alpha() { return this.m[this.o + 57]; }
  set alpha(v: number) { this.m[this.o + 57] = v; }
  get animationTimer() { return this.m[this.o + 58]; }
  set animationTimer(v: number) { this.m[this.o + 58] = v; }
  get animationSpeed() { return this.m[this.o + 59]; }
  set animationSpeed(v: number) { this.m[this.o + 59] = v; }
  get lookPosX() { return this.m[this.o + 60]; }
  set lookPosX(v: number) { this.m[this.o + 60] = v; }
  get lookPosY() { return this.m[this.o + 61]; }
  set lookPosY(v: number) { this.m[this.o + 61] = v; }
  get groupID() { return this.m[this.o + 62]; }
  set groupID(v: number) { this.m[this.o + 62] = v & 0xffff; }
  get type() { return this.m[this.o + 63]; }
  set type(v: number) { this.m[this.o + 63] = v & 0xff; }
  get propertyValue() { return this.m[this.o + 64]; }
  set propertyValue(v: number) { this.m[this.o + 64] = v & 0xff; }
  get priority() { return this.m[this.o + 65]; }
  set priority(v: number) { this.m[this.o + 65] = v & 0xff; }
  get drawOrder() { return this.m[this.o + 66]; }
  set drawOrder(v: number) { this.m[this.o + 66] = v & 0xff; }
  get direction() { return this.m[this.o + 67]; }
  set direction(v: number) { this.m[this.o + 67] = v & 0xff; }
  get inkEffect() { return this.m[this.o + 68]; }
  set inkEffect(v: number) { this.m[this.o + 68] = v & 0xff; }
  get animation() { return this.m[this.o + 69]; }
  set animation(v: number) { this.m[this.o + 69] = v & 0xff; }
  get prevAnimation() { return this.m[this.o + 70]; }
  set prevAnimation(v: number) { this.m[this.o + 70] = v & 0xff; }
  get frame() { return this.m[this.o + 71]; }
  set frame(v: number) { this.m[this.o + 71] = v & 0xff; }
  get collisionMode() { return this.m[this.o + 72]; }
  set collisionMode(v: number) { this.m[this.o + 72] = v & 0xff; }
  get collisionPlane() { return this.m[this.o + 73]; }
  set collisionPlane(v: number) { this.m[this.o + 73] = v & 0xff; }
  get controlMode() { return this.m[this.o + 74]; }
  set controlMode(v: number) { this.m[this.o + 74] = (v << 24) >> 24; }
  get controlLock() { return this.m[this.o + 75]; }
  set controlLock(v: number) { this.m[this.o + 75] = v & 0xff; }
  get pushing() { return this.m[this.o + 76]; }
  set pushing(v: number) { this.m[this.o + 76] = v & 0xff; }
  get visible() { return this.m[this.o + 77]; }
  set visible(v: number | boolean) { this.m[this.o + 77] = +v & 0xff; }
  get tileCollisions() { return this.m[this.o + 78]; }
  set tileCollisions(v: number | boolean) { this.m[this.o + 78] = +v & 0xff; }
  get objectInteractions() { return this.m[this.o + 79]; }
  set objectInteractions(v: number | boolean) { this.m[this.o + 79] = +v & 0xff; }
  get gravity() { return this.m[this.o + 80]; }
  set gravity(v: number | boolean) { this.m[this.o + 80] = +v & 0xff; }
  get left() { return this.m[this.o + 81]; }
  set left(v: number | boolean) { this.m[this.o + 81] = +v & 0xff; }
  get right() { return this.m[this.o + 82]; }
  set right(v: number | boolean) { this.m[this.o + 82] = +v & 0xff; }
  get up() { return this.m[this.o + 83]; }
  set up(v: number | boolean) { this.m[this.o + 83] = +v & 0xff; }
  get down() { return this.m[this.o + 84]; }
  set down(v: number | boolean) { this.m[this.o + 84] = +v & 0xff; }
  get jumpPress() { return this.m[this.o + 85]; }
  set jumpPress(v: number | boolean) { this.m[this.o + 85] = +v & 0xff; }
  get jumpHold() { return this.m[this.o + 86]; }
  set jumpHold(v: number | boolean) { this.m[this.o + 86] = +v & 0xff; }
  get scrollTracking() { return this.m[this.o + 87]; }
  set scrollTracking(v: number | boolean) { this.m[this.o + 87] = +v & 0xff; }

  setFloorSensor(i: number, v: number | boolean) {
    this.m[this.o + 88 + i] = +v & 0xff;
  }

  /** memset(entity, 0, sizeof(Entity)) */
  clear(): void {
    this.m.fill(0, this.o, this.o + ENT_STRIDE);
  }

  /** memcpy(this, src, sizeof(Entity)) */
  copyFrom(src: Entity): void {
    this.m.copyWithin(this.o, src.o, src.o + ENT_STRIDE);
  }
}
