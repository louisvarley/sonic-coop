import type { ScriptPatch } from "../../tools/patch.js";
import { signpostGather } from "../shared/patches.js";

// Co-op changes to the original Sonic 1 scripts (see docs/ARCHITECTURE.md, "Co-op on top of the original scripts").
// Every edit is guarded by `coop.enabled`, so single-player behaves exactly like the original.
// Sonic 1 keeps one global life counter: in co-op it stays player 1's, and coop.p2Lives holds player 2's.

const COOP_RESPAWN = `
// Ring Link co-op: instead of ending the act, a player who loses a life comes back next to their partner.
// A player on their last life borrows one from the partner; the game is over only when neither can continue.
// Sets checkResult to true when the player was respawned.
public function Player_CoopRespawn
	checkResult = false
	arrayPos1 = player.entityPos
	arrayPos1 ^= 1
	if player[arrayPos1].groupID == GROUP_PLAYERS
		CheckEqual(player[arrayPos1].state, Player_State_Death)
		temp0 = checkResult
		CheckEqual(player[arrayPos1].state, Player_State_Drown)
		temp0 |= checkResult
		if temp0 == false
			if player.entityPos == 0
				temp1 = player.lives
				temp2 = coop.p2Lives
			else
				temp1 = coop.p2Lives
				temp2 = player.lives
			end if
			if temp1 <= 0
				if temp2 > 1
					temp2--
					temp1 = 1
				end if
			end if
			if player.entityPos == 0
				player.lives = temp1
				coop.p2Lives = temp2
			else
				coop.p2Lives = temp1
				player.lives = temp2
			end if
			if temp1 > 0
				player.state			= Player_State_Air
				player.xpos				= player[arrayPos1].xpos
				player.ypos				= player[arrayPos1].ypos
				player.ypos				-= 0x200000
				player.xvel				= 0
				player.yvel				= 0
				player.speed			= 0
				player.rings			= 0
				player.gravity			= GRAVITY_AIR
				player.animation		= ANI_JUMPING
				player.tileCollisions	= true
				player.interaction		= true
				player.visible			= true
				player.controlMode		= player.entityPos
				player.scrollTracking	= true
				player.drawOrder		= DRAWORDER_PLAYER
				player.sortedDrawOrder	= 4
				player.collisionPlane	= player[arrayPos1].collisionPlane
				player.priority			= PRIORITY_ACTIVE
				player.blinkTimer		= 120
				currentPlayer = player.entityPos
				camera[currentPlayer].xpos		= player.ixpos
				camera[currentPlayer].ypos		= player.iypos
				camera[currentPlayer].style		= CAMERASTYLE_FOLLOW
				camera[currentPlayer].enabled	= true
				checkResult = true
			end if
		end if
	end if
end function


// Called by the player object itself to die - Gadzooks!
public function Player_State_Death`;

const respawnCall = (decrement: string) => `			if coop.enabled == true
				if player.entityPos == 0
${decrement.replace(/LIVES/g, "player.lives")}
				else
${decrement.replace(/LIVES/g, "coop.p2Lives")}
				end if
				CallFunction(Player_CoopRespawn)
				if checkResult == true
					return
				end if
			else
${decrement.replace(/LIVES/g, "player.lives")}
			end if`;

export const patches: ScriptPatch[] = [
  // ---- player 2 -------------------------------------------------------------------------------------------------
  {
    file: "Players/Player2Object.txt",
    reason: "input function for a human-controlled player 2",
    find: `public function Player2_Input_None
	temp0 = 0
end function`,
    replace: `public function Player2_Input_None
	temp0 = 0
end function


// Ring Link co-op: player 2 reads their own pad
public function Player2_Input_Human
	ProcessObjectControl()
end function`,
  },
  {
    file: "Players/Player2Object.txt",
    reason: "create a human player 2 (Sonic or Tails) instead of the AI sidekick",
    find: `	if stage.player2Enabled == true
		// Always make P2 start 16 pixels to the left of P1`,
    replace: `	if coop.enabled == true
		ResetObjectEntity(SLOT_PLAYER2, TypeName[Player 2 Object], coop.p2Character, player[SLOT_PLAYER1].xpos, player[SLOT_PLAYER1].ypos)
		player[SLOT_PLAYER2].xpos -= 0x100000
		LoadSpriteSheet("Players/Tails1.gif")
		if coop.p2Character == CHARACTER_TAILS
			LoadAnimation("Tails.ani")
		else
			LoadAnimation("Sonic.ani")
		end if
		SpriteFrame(-22, -8, 16, 24, 82, 199)
		SpriteFrame(-26, -8, 20, 24, 99, 199)
		SpriteFrame(-26, -8, 20, 24, 120, 199)
		SpriteFrame(-26, -8, 20, 24, 141, 199)
		SpriteFrame(-26, -8, 20, 24, 162, 199)
		SpriteFrame(-35, -8, 24, 16, 231, 166)
		SpriteFrame(-35, -8, 24, 16, 231, 183)
		SpriteFrame(-35, -8, 24, 16, 231, 200)
		SpriteFrame(-25, 9, 20, 16, 235, 217)
		SpriteFrame(-25, 9, 18, 16, 237, 234)
		SpriteFrame(-25, 9, 20, 16, 216, 234)
		SpriteFrame(-30, -6, 24, 16, 231, 166)
		SpriteFrame(-30, -6, 24, 16, 231, 183)
		SpriteFrame(-30, -6, 24, 16, 231, 200)
		player[SLOT_PLAYER2].groupID = GROUP_PLAYERS
		player[SLOT_PLAYER2].character = coop.p2Character
		player[SLOT_PLAYER2].state = Player_State_Air
		player[SLOT_PLAYER2].priority = PRIORITY_ACTIVE
		player[SLOT_PLAYER2].controlMode = 1
		player[SLOT_PLAYER2].drawOrder = DRAWORDER_PLAYER
		player[SLOT_PLAYER2].sortedDrawOrder = 4
		currentPlayer = SLOT_PLAYER2
		CallFunction(Player_UpdatePhysicsState)
		player[SLOT_PLAYER2].rollingDeceleration = 0x2000
		if coop.p2Character == CHARACTER_TAILS
			player[SLOT_PLAYER2].jumpOffset = -1
			player[SLOT_PLAYER2].jumpAbility = Player_Action_DblJumpTails
		else
			player[SLOT_PLAYER2].jumpOffset = -5
			player[SLOT_PLAYER2].jumpAbility = Player_Action_DblJumpSonic
		end if
		player[SLOT_PLAYER2].isSidekick = false
		if options.spindash == true
			player[SLOT_PLAYER2].actionSpindash = Player_Action_Spindash
		else
			player[SLOT_PLAYER2].actionSpindash = Player_Action_Jump
		end if
		player[SLOT_PLAYER2].stateInputP2 = Player2_Input_Human
		player[SLOT_PLAYER2].hitboxLeft 	= C_BOX
		player[SLOT_PLAYER2].hitboxRight 	= C_BOX
		player[SLOT_PLAYER2].hitboxTop 	= C_BOX
		player[SLOT_PLAYER2].hitboxBottom 	= C_BOX
		camera[1].enabled = true
		camera[1].style = CAMERASTYLE_FOLLOW
		camera[1].target = SLOT_PLAYER2
		camera[1].xpos = object[SLOT_PLAYER2].ixpos
		camera[1].ypos = object[SLOT_PLAYER2].iypos
	else
	if stage.player2Enabled == true
		// Always make P2 start 16 pixels to the left of P1`,
  },
  {
    file: "Players/Player2Object.txt",
    reason: "close the co-op/sidekick branch opened above",
    find: `#platform: USE_ORIGINS
		AssignInputSlotToDevice(2, -1)
#endplatform
	end if
end event`,
    replace: `#platform: USE_ORIGINS
		AssignInputSlotToDevice(2, -1)
#endplatform
	end if
	end if
end event`,
  },
  {
    file: "Players/Player2Object.txt",
    reason: "a human player 2 never flies back to player 1 like the AI sidekick",
    find: `	CallFunction(Player2_HandleSidekickRespawn)
end event`,
    replace: `	if coop.enabled == false
		CallFunction(Player2_HandleSidekickRespawn)
	end if
end event`,
  },
  {
    file: "Players/Player2Object.txt",
    reason: "only Tails has tails to draw",
    find: `	// Draw the Tails part of Tails
	switch player.tailAnim`,
    replace: `	// Draw the Tails part of Tails
	if player.character == CHARACTER_TAILS
	switch player.tailAnim`,
  },
  {
    file: "Players/Player2Object.txt",
    reason: "close the tails-only drawing branch",
    find: `	end switch

	// Draw Tails himself`,
    replace: `	end switch
	end if

	// Draw Tails himself`,
  },

  // ---- player 1 ----------------------------------------------------------------------------------------------
  {
    file: "Players/PlayerObject.txt",
    reason: "Tails as player 1 keeps player 2 in co-op",
    find: `			// Tails can't have Miles following him, unfortunately
			stage.player2Enabled = false`,
    replace: `			// Tails can't have Miles following him, unfortunately (but co-op can have a second human player)
			if coop.enabled == false
				stage.player2Enabled = false
			end if`,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "player 1's death does not freeze the level for player 2",
    find: `		// Is this the main character?
		if currentPlayer == 0`,
    replace: `		// Is this the main character? (in co-op the level keeps running)
		temp0 = currentPlayer
		temp0 |= coop.enabled
		if temp0 == 0`,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "co-op respawn function",
    find: `

// Called by the player object itself to die - Gadzooks!
public function Player_State_Death`,
    replace: COOP_RESPAWN,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "per-player lives and respawn after dying",
    find: `		if player.isSidekick == false
#platform: USE_STANDALONE
			player.lives--
#endplatform`,
    replace: `		if player.isSidekick == false
#platform: USE_STANDALONE
${respawnCall("\t\t\t\tLIVES--")}
#endplatform`,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "per-player lives and respawn after drowning",
    find: `		if player.isSidekick == false
#platform: USE_STANDALONE
			if player.lives > 0
				player.lives--
			end if
#endplatform`,
    replace: `		if player.isSidekick == false
#platform: USE_STANDALONE
${respawnCall("\t\t\t\tif LIVES > 0\n\t\t\t\t\tLIVES--\n\t\t\t\tend if")}
#endplatform`,
  },

  // ---- level rules that follow each player's own camera ---------------------------------------------------------
  {
    file: "Global/StageSetup.txt",
    reason: "each player is kept inside their own camera's left boundary",
    find: `			temp0 += player[currentPlayer].xpos
			temp1 = stage.curXBoundary1
			temp1 <<= 16`,
    replace: `			temp0 += player[currentPlayer].xpos
			temp1 = camera[currentPlayer].curXBoundary1
			temp1 <<= 16`,
  },
  {
    file: "Global/StageSetup.txt",
    reason: "falling out of the level is judged against each player's own camera",
    find: `			temp1 = stage.curYBoundary2
			temp1 <<= 16

			if temp1 < stage.deathBoundary`,
    replace: `			temp1 = camera[currentPlayer].curYBoundary2
			temp1 <<= 16

			if temp1 < stage.deathBoundary`,
  },

  // ---- HUD: each screen shows its own player's rings and lives --------------------------------------------------
  {
    file: "Global/HUD.txt",
    reason: "draw the HUD for the player whose screen this is",
    find: `private function HUD_Draw_Standard
`,
    replace: `private function HUD_Draw_Standard
	currentPlayer = screen.currentID
`,
  },
  {
    file: "Global/HUD.txt",
    reason: "per-player red RINGS warning",
    find: `			if player[0].rings == 0
				if object.flashTimer > 7
					DrawSpriteScreenXY(12, 17, 45)`,
    replace: `			if player[currentPlayer].rings == 0
				if object.flashTimer > 7
					DrawSpriteScreenXY(12, 17, 45)`,
  },
  {
    file: "Global/HUD.txt",
    reason: "per-player ring count",
    find: `			DrawNumbers(0, 80, 45, player[0].rings, 3, 8, false)`,
    replace: `			DrawNumbers(0, 80, 45, player[currentPlayer].rings, 3, 8, false)`,
  },
  {
    file: "Global/HUD.txt",
    reason: "per-player life icon",
    find: `		// Draw life indicator
		temp0 = stage.playerListPos`,
    replace: `		// Draw life indicator
		temp0 = stage.playerListPos
		if currentPlayer != 0
			temp0 = object[currentPlayer].propertyValue
		end if`,
  },
  {
    file: "Global/HUD.txt",
    reason: "per-player life count",
    find: `		DrawSpriteScreenXY(20, 38, 222)
		DrawNumbers(24, 56, 220, player.lives, 2, 8, false)`,
    replace: `		DrawSpriteScreenXY(20, 38, 222)
		if currentPlayer == 0
			DrawNumbers(24, 56, 220, player.lives, 2, 8, false)
		else
			DrawNumbers(24, 56, 220, coop.p2Lives, 2, 8, false)
		end if`,
  },

  // ---- goal: whichever player reaches the sign post first finishes the act -----------------------------------
  {
    file: "Global/SignPost.txt",
    reason: "the sign post reacts to the leading player",
    find: `	case SIGNPOST_AWAITPLAYER
		temp0 = object.ypos
		temp0 += 0x400000
		if player[0].ypos < temp0`,
    replace: `	case SIGNPOST_AWAITPLAYER
		currentPlayer = 0
		if coop.enabled == true
			if player[1].xpos > player[0].xpos
				currentPlayer = 1
			end if
		end if
		temp0 = object.ypos
		temp0 += 0x400000
		if player[currentPlayer].ypos < temp0`,
  },
  {
    file: "Global/SignPost.txt",
    reason: "the leading player passing the sign post spins it and brings the other player along",
    find: `			if player[0].xpos > object.xpos
				stage.newXBoundary1 = object.xpos
				stage.newXBoundary1 >>= 16
				stage.newXBoundary1 -= screen.xcenter`,
    replace: `			if player[currentPlayer].xpos > object.xpos
				stage.newXBoundary1 = object.xpos
				stage.newXBoundary1 >>= 16
				stage.newXBoundary1 -= screen.xcenter
${signpostGather("\t\t\t\t")}`,
  },
];
