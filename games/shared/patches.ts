// Script fragments shared by the Sonic 1 and Sonic 2 co-op patches.

/** Replace a player-1-only horizontal gate with a check for the player furthest ahead. Indented with `indent`. */
export function leadingPlayerXCheck(indent: string, condition: string): string {
  return [
    `${indent}temp7 = player[0].xpos`,
    `${indent}if coop.enabled == true`,
    `${indent}\tif player[1].xpos > temp7`,
    `${indent}\t\ttemp7 = player[1].xpos`,
    `${indent}\tend if`,
    `${indent}end if`,
    `${indent}if temp7 ${condition}`,
  ].join("\n");
}

/**
 * When the leading player (currentPlayer) passes the sign post, a partner who is far behind is brought next to
 * them, so both take part in the end-of-act run. Indented with `indent`.
 */
export function signpostGather(indent: string): string {
  const lines = [
    "if coop.enabled == true",
    "\tarrayPos1 = currentPlayer",
    "\tarrayPos1 ^= 1",
    "\ttemp1 = object[currentPlayer].xpos",
    "\ttemp1 -= object[arrayPos1].xpos",
    "\tif temp1 > 0x1000000",
    "\t\tobject[arrayPos1].xpos = object[currentPlayer].xpos",
    "\t\tobject[arrayPos1].xpos -= 0x200000",
    "\t\tobject[arrayPos1].ypos = object[currentPlayer].ypos",
    "\t\tobject[arrayPos1].xvel = 0",
    "\t\tobject[arrayPos1].yvel = 0",
    "\t\tobject[arrayPos1].speed = 0",
    "\t\tobject[arrayPos1].state = Player_State_Air",
    "\t\tobject[arrayPos1].gravity = GRAVITY_AIR",
    "\t\tobject[arrayPos1].collisionPlane = object[currentPlayer].collisionPlane",
    "\t\tcamera[arrayPos1].xpos = object[arrayPos1].ixpos",
    "\t\tcamera[arrayPos1].ypos = object[arrayPos1].iypos",
    "\tend if",
    "end if",
  ];
  return lines.map((l) => indent + l).join("\n");
}
