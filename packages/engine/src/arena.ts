// Co-op boss arenas. In the original one camera exists, so a boss that locks the screen locks the only player in
// with it. With a camera per player, a player who is ahead of (or far away from) the arena would keep their own
// screen and walk past the boss. Boundaries a boss script sets therefore apply to every camera, and while the boss
// is alive any player outside its arena is brought to a partner inside it.

/** The scripts of bosses (and boss-like set pieces) whose screen locks every player shares. */
export const BOSS_SCRIPT = /(?:^|\/)(?:Eggman|Eggman2|FZEggman|MechaSonic|DeathEggRobot|B08Eggman|Boss_Face|BossSpikes|BossBarrier|Hotaru)\.txt$/i;

/** Locks wider than this (in pixels) are not arenas (bosses open the screen up again when they are beaten). */
export const ARENA_MAX_WIDTH = 1280;

/** How far outside an arena (in pixels) a player may be before they are brought in (the player scripts let a player
 * stand a little past the screen edge, and jumps go above it). */
export const ARENA_MARGIN_X = 64;
export const ARENA_MARGIN_Y = 240;

export function isBossScript(path: string): boolean {
  return BOSS_SCRIPT.test(path.replace(/\\/g, "/"));
}
