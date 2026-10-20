import type { ScriptPatch } from "../../tools/patch.js";
import { leadingPlayerXCheck, signpostGather } from "../shared/patches.js";

// Co-op changes to the original Sonic 2 scripts (see docs/ARCHITECTURE.md, "Co-op on top of the original scripts").
// Every edit is guarded by `coop.enabled`, so single-player behaves exactly like the original.

const COOP_RESPAWN = `
// Ring Link co-op: instead of ending the act, a player who loses a life comes back on their own: at the last star
// post (or where the act started), or next to their partner when coop.respawnRule says so or the checkpoint is
// outside the current screen lock (a boss arena). With limited lives a player on their last life borrows one from
// a living partner; the game is over only when neither can continue. Sets checkResult when the player respawned.
public function Player_CoopRespawn
	checkResult = false
	arrayPos1 = player.entityPos
	arrayPos1 ^= 1
	temp3 = false
	if player[arrayPos1].groupID == GROUP_PLAYERS
		CheckEqual(player[arrayPos1].state, Player_State_Death)
		temp0 = checkResult
		CheckEqual(player[arrayPos1].state, Player_State_Drown)
		temp0 |= checkResult
		if temp0 == false
			temp3 = true
		end if
	end if
	arrayPos0 = VarName[player.lives]
	arrayPos0 += player.entityPos
	arrayPos2 = VarName[player.lives]
	arrayPos2 += arrayPos1
	if global[arrayPos0] <= 0
		if temp3 == true
			if global[arrayPos2] > 1
				global[arrayPos2]--
				global[arrayPos0] = 1
			end if
		end if
	end if
	if global[arrayPos0] > 0
		temp4 = coop.spawnX
		temp5 = coop.spawnY
		if starPostID >= 32
			arrayPos2 = starPostID
			temp4 = object[arrayPos2].xpos
			temp5 = object[arrayPos2].ypos
		end if
		temp0 = false
		if coop.respawnRule == 0
			temp0 = true
		end if
		temp6 = temp4
		temp6 >>= 16
		if temp6 < stage.newXBoundary1
			temp0 = true
		end if
		if temp6 > stage.newXBoundary2
			temp0 = true
		end if
		temp0 &= temp3
		if temp0 == true
			player.xpos				= player[arrayPos1].xpos
			player.ypos				= player[arrayPos1].ypos
			player.ypos				-= 0x200000
			player.collisionPlane	= player[arrayPos1].collisionPlane
		else
			player.xpos				= temp4
			player.ypos				= temp5
			player.collisionPlane	= 0
		end if
		player.state			= Player_State_Air
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
		player.priority			= PRIORITY_ACTIVE
		player.blinkTimer		= 120
		currentPlayer = player.entityPos
		camera[currentPlayer].xpos		= player.ixpos
		camera[currentPlayer].ypos		= player.iypos
		camera[currentPlayer].style		= CAMERASTYLE_FOLLOW
		camera[currentPlayer].enabled	= true
		camera[currentPlayer].curXBoundary1 = stage.newXBoundary1
		camera[currentPlayer].curXBoundary2 = stage.newXBoundary2
		camera[currentPlayer].curYBoundary1 = stage.newYBoundary1
		camera[currentPlayer].curYBoundary2 = stage.newYBoundary2
		checkResult = true
	end if
end function


public function Player_State_Death`;

const COOP_RESPAWN_CALL = `			if coop.enabled == true
				CallFunction(Player_CoopRespawn)
				if checkResult == true
					return
				end if
			end if

`;

export const patches: ScriptPatch[] = [
  // ---- player 2: a second human player with their own character, camera, rings and lives ----------------------
  {
    file: "Players/Player2Object.txt",
    reason: "input function for a human-controlled player 2",
    find: `public function Player2_Input_None
	temp0 = 0
end function`,
    replace: `public function Player2_Input_None
	temp0 = 0
end function


// Ring Link co-op: player 2 reads their own pad (controlMode = CONTROLMODE_P2 = pad 2)
public function Player2_Input_Human
	ProcessObjectControl()
end function`,
  },
  {
    file: "Players/Player2Object.txt",
    reason: "create a human player 2 (any character) instead of the AI sidekick",
    find: `	if stage.player2Enabled == true
		ResetObjectEntity(SLOT_PLAYER2, TypeName[Player 2 Object], PLAYER_TAILS_A, player[SLOT_PLAYER1].xpos, player[SLOT_PLAYER1].ypos)`,
    replace: `	if coop.enabled == true
		coop.spawnX = player[SLOT_PLAYER1].xpos
		coop.spawnY = player[SLOT_PLAYER1].ypos
		ResetObjectEntity(SLOT_PLAYER2, TypeName[Player 2 Object], coop.p2Character, player[SLOT_PLAYER1].xpos, player[SLOT_PLAYER1].ypos)
		if starPostID == 0
			player[SLOT_PLAYER2].xpos -= 0x100000
		end if
		player[SLOT_PLAYER2].groupID 				= GROUP_PLAYERS
		player[SLOT_PLAYER2].state					= Player_State_Air
		player[SLOT_PLAYER2].priority 				= PRIORITY_ACTIVE
		player[SLOT_PLAYER2].controlMode 			= CONTROLMODE_P2
		player[SLOT_PLAYER2].drawOrder 				= DRAWORDER_PLAYER
		player[SLOT_PLAYER2].sortedDrawOrder 		= 4
		player[SLOT_PLAYER2].rollingDeceleration 	= 0x2000
		player[SLOT_PLAYER2].spindashFunction 		= Player_Action_Spindash
		currentPlayer = SLOT_PLAYER2
		CallFunction(Player_UpdatePhysicsState)
		player[SLOT_PLAYER2].hitboxTop 		= C_BOX
		player[SLOT_PLAYER2].hitboxBottom 	= C_BOX
		player[SLOT_PLAYER2].hitboxLeft 	= C_BOX
		player[SLOT_PLAYER2].hitboxRight 	= C_BOX
		player[SLOT_PLAYER2].isSidekick 		= false
		player[SLOT_PLAYER2].p2InputFunction 	= Player2_Input_Human
		camera[1].enabled = true
		camera[1].style = CAMERASTYLE_FOLLOW
		camera[1].target = SLOT_PLAYER2
		camera[1].xpos = player[SLOT_PLAYER2].ixpos
		camera[1].ypos = player[SLOT_PLAYER2].iypos
		if coop.p2Character == PLAYER_KNUCKLES_A
			LoadAnimation("Knuckles.ani")
			player[SLOT_PLAYER2].character 		= PLAYER_KNUCKLES_A
			player[SLOT_PLAYER2].jumpOffset 	= -5
			player[SLOT_PLAYER2].jumpAbility 	= Player_Action_DblJumpKnux
		else
		if coop.p2Character == PLAYER_TAILS_A
			LoadAnimation("Tails.ani")
			player[SLOT_PLAYER2].character 		= PLAYER_TAILS_A
			player[SLOT_PLAYER2].jumpOffset 	= -1
			if coop.tailsFlight == true
				player[SLOT_PLAYER2].jumpAbility = Player_Action_DblJumpTails
			else
				player[SLOT_PLAYER2].jumpAbility = Player_State_Static
			end if
		else
			LoadAnimation("Sonic.ani")
			player[SLOT_PLAYER2].character 		= PLAYER_SONIC_A
			player[SLOT_PLAYER2].jumpOffset 	= -5
			player[SLOT_PLAYER2].jumpAbility 	= Player_Action_DblJumpSonic
		end if
		end if
		playerCount = 2
		temp7 = true
	else
	if stage.player2Enabled == true
		ResetObjectEntity(SLOT_PLAYER2, TypeName[Player 2 Object], PLAYER_TAILS_A, player[SLOT_PLAYER1].xpos, player[SLOT_PLAYER1].ypos)`,
  },
  {
    file: "Players/Player2Object.txt",
    reason: "close the co-op/sidekick branch opened above",
    find: `		temp7 = true

#platform: USE_ORIGINS
		AssignInputSlotToDevice(2, -1)
#endplatform
	end if`,
    replace: `		temp7 = true

#platform: USE_ORIGINS
		AssignInputSlotToDevice(2, -1)
#endplatform
	end if
	end if`,
  },
  {
    file: "Players/Player2Object.txt",
    reason: "a human player 2 never flies back to player 1 like the AI sidekick",
    find: `	if options.vsMode == false
		CallFunction(Player2_HandleSidekickRespawn)
	end if`,
    replace: `	if options.vsMode == false
		if coop.enabled == false
			CallFunction(Player2_HandleSidekickRespawn)
		end if
	end if`,
  },

  // ---- player 1 ----------------------------------------------------------------------------------------------
  {
    file: "Players/PlayerObject.txt",
    reason: "Tails as player 1 keeps player 2 in co-op",
    find: `			if options.tailsFlight == true
				player[SLOT_PLAYER1].jumpAbility = Player_Action_DblJumpTails
			else
				player[SLOT_PLAYER1].jumpAbility = Player_State_Static // Not being used as a State here, simply more of a dummy function
			end if

			stage.player2Enabled = false`,
    replace: `			if options.tailsFlight == true
				player[SLOT_PLAYER1].jumpAbility = Player_Action_DblJumpTails
			else
				player[SLOT_PLAYER1].jumpAbility = Player_State_Static // Not being used as a State here, simply more of a dummy function
			end if

			if coop.enabled == false
				stage.player2Enabled = false
			end if`,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "player 1's death does not freeze the level for player 2",
    find: `		if options.vsMode == false
			if currentPlayer == 0
				// If P1 is the one who died, then freeze everything else`,
    replace: `		temp0 = options.vsMode
		temp0 |= coop.enabled
		if temp0 == false
			if currentPlayer == 0
				// If P1 is the one who died, then freeze everything else`,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "co-op respawn function",
    find: `

public function Player_State_Death`,
    replace: COOP_RESPAWN,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "respawn next to the partner after dying",
    find: `			if options.vsMode == false
				stage.timeEnabled = false

				player.type = TypeName[Death Event]`,
    replace: `${COOP_RESPAWN_CALL}			if options.vsMode == false
				stage.timeEnabled = false

				player.type = TypeName[Death Event]`,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "respawn next to the partner after drowning",
    find: `			if options.vsMode == false
				stage.timeEnabled 		= false

				player.type 			= TypeName[Death Event]`,
    replace: `${COOP_RESPAWN_CALL}			if options.vsMode == false
				stage.timeEnabled 		= false

				player.type 			= TypeName[Death Event]`,
  },

  // ---- boss triggers: either co-op player can start the encounter ------------------------------------------------
  {
    file: "EHZ/Eggman.txt",
    reason: "the leading co-op player starts the Emerald Hill boss encounter",
    find: `		if player[0].xpos > object.xpos`,
    replace: leadingPlayerXCheck("\t\t", "> object.xpos"),
  },
  {
    file: "CPZ/Eggman.txt",
    reason: "the leading co-op player starts the Chemical Plant boss encounter",
    find: `		if player[0].xpos > object.xpos`,
    replace: leadingPlayerXCheck("\t\t", "> object.xpos"),
  },
  {
    file: "ARZ/Eggman.txt",
    reason: "the leading co-op player starts the Aquatic Ruin boss encounter",
    find: `		if player[0].xpos > object.xpos`,
    replace: leadingPlayerXCheck("\t\t", "> object.xpos"),
  },
  {
    file: "OOZ/Eggman.txt",
    reason: "the leading co-op player starts the Oil Ocean boss encounter",
    find: `	case OOZEGGMAN_AWAITPLAYER
		if player[0].xpos > object.xpos`,
    replace: `	case OOZEGGMAN_AWAITPLAYER
${leadingPlayerXCheck("\t\t", "> object.xpos")}`,
  },
  {
    file: "HTZ/Eggman.txt",
    reason: "the leading co-op player starts the Hill Top boss encounter",
    find: `		if player[0].xpos >= temp0 // Only activate when the player's past the trigger point`,
    replace: `${leadingPlayerXCheck("\t\t", ">= temp0")} // Only activate when the player's past the trigger point`,
  },
  {
    file: "MPZ/Eggman.txt",
    reason: "the leading co-op player starts the Mystic Cave boss encounter",
    find: `		if player[0].xpos >= object.xpos`,
    replace: leadingPlayerXCheck("\t\t", ">= object.xpos"),
  },
  {
    file: "CNZ/Eggman.txt",
    reason: "the leading co-op player starts the Casino Night boss encounter",
    find: `		if player[0].xpos > object[-1].xpos`,
    replace: leadingPlayerXCheck("\t\t", "> object[-1].xpos"),
  },
  {
    file: "HPZ/Eggman.txt",
    reason: "the leading co-op player starts the Hidden Palace boss encounter",
    find: `		if player[0].xpos > object[+1].xpos`,
    replace: leadingPlayerXCheck("\t\t", "> object[+1].xpos"),
  },
  {
    file: "WFZ/Eggman.txt",
    reason: "the leading co-op player starts the Wing Fortress boss encounter",
    find: `		if player[0].xpos > temp0`,
    replace: leadingPlayerXCheck("\t\t", "> temp0"),
  },
  {
    file: "MCZ/Eggman.txt",
    reason: "the leading co-op player reaches the boss entry threshold",
    find: `		if player[0].xpos > temp0`,
    replace: leadingPlayerXCheck("\t\t", "> temp0"),
  },

  // ---- level rules that must follow each player's own camera ----------------------------------------------------
  {
    file: "Global/StageSetup.txt",
    reason: "each player is kept inside their own camera's left boundary",
    find: `			temp1 = stage.curXBoundary1
			temp1 <<= 16
			if temp0 < temp1`,
    replace: `			temp1 = camera[currentPlayer].curXBoundary1
			temp1 <<= 16
			if temp0 < temp1`,
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

  // ---- HUD: each screen shows its own player's score, rings and lives -----------------------------------------
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
    find: `#platform: USE_STANDALONE
			if player[0].rings == 0
#endplatform`,
    replace: `#platform: USE_STANDALONE
			if player[currentPlayer].rings == 0
#endplatform`,
  },
  {
    file: "Global/HUD.txt",
    reason: "per-player score",
    find: `#platform: USE_STANDALONE
			DrawNumbers(0, 104, 13, player.score, 6, 8, false)
#endplatform`,
    replace: `#platform: USE_STANDALONE
			arrayPos0 = VarName[player.score]
			arrayPos0 += currentPlayer
			DrawNumbers(0, 104, 13, global[arrayPos0], 6, 8, false)
#endplatform`,
  },
  {
    file: "Global/HUD.txt",
    reason: "per-player ring count",
    find: `			DrawNumbers(0, 56, 29, stage.minutes, 1, 8, true)
			DrawNumbers(0, 80, 45, player[0].rings, 3, 8, false)`,
    replace: `			DrawNumbers(0, 56, 29, stage.minutes, 1, 8, true)
			DrawNumbers(0, 80, 45, player[currentPlayer].rings, 3, 8, false)`,
  },
  {
    file: "Global/HUD.txt",
    reason: "per-player lives icon and count",
    find: `			// Lives icon
			temp0 = stage.playerListPos
			temp0 += 15
			DrawSpriteScreenXY(temp0, 16, 212)

			// Character text
			temp0 += 6
			DrawSpriteScreenXY(temp0, 33, 213)

			// X between icon and number
			DrawSpriteScreenXY(20, 38, 222)

			// The actual player lives number
			DrawNumbers(24, 56, 220, player.lives, 2, 8, false)`,
    replace: `			// Lives icon
			temp0 = object[currentPlayer].propertyValue
			if currentPlayer == 0
				temp0 = stage.playerListPos
			end if
			temp0 += 15
			DrawSpriteScreenXY(temp0, 16, 212)

			// Character text
			temp0 += 6
			DrawSpriteScreenXY(temp0, 33, 213)

			// X between icon and number
			DrawSpriteScreenXY(20, 38, 222)

			// The actual player lives number (or ∞, frame 38, added below)
			if coop.infiniteLives == true
				DrawSpriteScreenXY(38, 48, 220)
			else
				arrayPos0 = VarName[player.lives]
				arrayPos0 += currentPlayer
				DrawNumbers(24, 56, 220, global[arrayPos0], 2, 8, false)
			end if`,
  },

  // ---- goal: whichever player reaches the sign post first finishes the act -----------------------------------
  {
    file: "Global/SignPost.txt",
    reason: "the sign post reacts to the leading player",
    find: `	case SIGNPOST_IDLE
#platform: USE_ORIGINS
		object.fallbackTimer++
#endplatform

		temp0 = object.ypos
		temp0 += 0x400000
		if player[0].ypos < temp0`,
    replace: `	case SIGNPOST_IDLE
#platform: USE_ORIGINS
		object.fallbackTimer++
#endplatform

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
    reason: "the leading player passing the sign post spins it",
    find: `			if player[0].xpos > object.xpos
				stage.newXBoundary1 = object.xpos`,
    replace: `			if player[currentPlayer].xpos > object.xpos
${signpostGather("\t\t\t\t")}
				stage.newXBoundary1 = object.xpos`,
  },
  {
    file: "Global/SignPost.txt",
    reason: "the sign post shows the face of the player who reached it",
    find: `				switch player[0].character`,
    replace: `				switch player[currentPlayer].character`,
  },
  {
    file: "Global/SignPost.txt",
    reason: "the act ends when the leading player runs off screen",
    find: `		if player[0].xpos > temp0
			PlayMusic(TRACK_ACTFINISH)`,
    replace: `		currentPlayer = 0
		if coop.enabled == true
			if player[1].xpos > player[0].xpos
				currentPlayer = 1
			end if
		end if
		if player[currentPlayer].xpos > temp0
			PlayMusic(TRACK_ACTFINISH)`,
  },
  {
    file: "Global/HUD.txt",
    reason: "an ∞ sprite for infinite lives (#38: the engine paints it below the HUD sheet, see hudglyph.ts)",
    find: `	// Set the HUD's draw function based on the current platform
	foreach (TypeName[HUD], arrayPos0, ALL_ENTITIES)`,
    replace: `	// Ring Link: ∞ for infinite lives
	SpriteFrame(0, 0, 16, 8, 0, 256)	// #38 - Infinity

	// Set the HUD's draw function based on the current platform
	foreach (TypeName[HUD], arrayPos0, ALL_ENTITIES)`,
  },

  {
    file: "Players/PlayerObject.txt",
    reason: "player 1 killed by a hit does not freeze the level (or their camera) for player 2 either",
    find: `#platform: USE_STANDALONE
			camera[0].enabled = false
			if options.vsMode == false
				stage.state = STAGE_FROZEN
			end if
#endplatform`,
    replace: `#platform: USE_STANDALONE
			if coop.enabled == false
				camera[0].enabled = false
				if options.vsMode == false
					stage.state = STAGE_FROZEN
				end if
			end if
#endplatform`,
  },

  // ---- characters and host options -------------------------------------------------------------------------------
  {
    file: "Players/PlayerObject.txt",
    reason: "each co-op player uses their own character's physics (the original uses player 1's for both)",
    find: `softlocks incoming...

	switch stage.playerListPos
	case PLAYER_SONIC_A
	case PLAYER_SONIC_TAILS_A
		temp0 = Player_SonicPhysicsTable`,
    replace: `softlocks incoming...

	temp0 = stage.playerListPos
	if coop.enabled == true
		if currentPlayer == 1
			temp0 = player[1].character
		end if
	end if
	switch temp0
	case PLAYER_SONIC_A
	case PLAYER_SONIC_TAILS_A
		temp0 = Player_SonicPhysicsTable`,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "host option: Knuckles drops off walls instead of climbing them",
    count: 2,
    find: `				if temp2 == temp3
					player.state = Player_State_Climb`,
    replace: `				if coop.knuxClimb == false
					temp2 = temp3
					temp2++
				end if
				if temp2 == temp3
					player.state = Player_State_Climb`,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "host option: Tails' flight for player 1",
    find: `			if options.tailsFlight == true
				player[SLOT_PLAYER1].jumpAbility = Player_Action_DblJumpTails`,
    replace: `			if coop.tailsFlight == false
				options.tailsFlight = false
			end if
			if options.tailsFlight == true
				player[SLOT_PLAYER1].jumpAbility = Player_Action_DblJumpTails`,
  },
];
