import type { ScriptPatch } from "../../tools/patch.js";

// Two-player co-op for the player scripts of Sonic CD (the Use_Standalone platform the engine compiles: Sonic and
// Tails). The engine (packages/engine/src/v3) runs the scripts for each player with Stage.ActivePlayer set to that
// player, keeps one Stage.PlayerListPos per player and reports the player count as Stage.PlayerCount, so every edit is
// guarded by `Stage.PlayerCount > 1` and a single-player game behaves exactly like the original.
//
// Player 2 lives in entity 5 (its Tails' tail in entity 6); entities 0 and 1 are player 1 and its tail.
// Known limits: rings, lives and score are shared, and shield / invincibility pickups (Object[2]) follow player 1.

const SETUP_LOOP = `#platform: Use_Standalone
	ArrayPos0 = 32
	while ArrayPos0 < 1056
		if Object[ArrayPos0].Type == TypeName[Player Object]
			Stage.ActivePlayer = 0
			CallFunction(Player_Setup_One)
			if Stage.PlayerCount > 1
				Stage.ActivePlayer = 1
				CallFunction(Player_Setup_One)
				Stage.ActivePlayer = 0
			end if

			ResetObjectEntity(ArrayPos0, TypeName[Blank Object], 0, 0, 0)
		end if

		ArrayPos0++
	loop
#endplatform
end sub


// Sets up the active player at the spawn point in ArrayPos0: player 1 in entity 0, player 2 in entity 5.
function Player_Setup_One
#platform: Use_Standalone
			TempValue3 = 0
			if Stage.ActivePlayer == 1
				TempValue3 = 5
			end if
			ResetObjectEntity(TempValue3, TypeName[Player Object], 0, Object[ArrayPos0].XPos, Object[ArrayPos0].YPos)
			BindPlayerToObject(Stage.ActivePlayer, TempValue3)
			Player.XPos = Object[ArrayPos0].XPos
			Player.YPos = Object[ArrayPos0].YPos

			switch Stage.PlayerListPos
			case PLAYER_SONIC_A
				LoadAnimation("Sonic.Ani")
				BindPlayerToObject(Stage.ActivePlayer, TempValue3)`;

const SETUP_TAILS = `			case PLAYER_TAILS_A
				LoadAnimation("Tails.Ani")
				BindPlayerToObject(Stage.ActivePlayer, TempValue3)`;

const COOP_RESPAWN = `
// Respawn independently at the shared checkpoint, or the original spawn before any checkpoint is reached.
// TempValue0 is the fall speed at which the death would complete.
function Player_CoopRespawn
	if Stage.PlayerCount > 1
		if Player.YVelocity > TempValue0
			TempValue3 = Object.XPos
			TempValue4 = Object.YPos
			if LampPost.Check > 31
				ArrayPos1 = LampPost.Check
				TempValue3 = Object[ArrayPos1].XPos
				TempValue3 += LampPost.Side
				TempValue4 = Object[ArrayPos1].YPos
			end if

			Player.State			 = Player_State_Air
			Player.XPos				 = TempValue3
			Player.YPos				 = TempValue4
			Player.Speed			 = 0
			Player.XVelocity		 = 0
			Player.YVelocity		 = 0
			Player.Gravity			 = GRAVITY_AIR
			Player.Animation		 = ANI_JUMPING
			Player.Rotation			 = 0
			Player.Angle			 = 0
			Player.CollisionMode	 = 0
			Player.ControlLock		 = 0
			Player.LookPos			 = 0
			Player.TileCollisions	 = true
			Player.ObjectInteraction = true
			Player.Visible			 = true
			Player.ControlMode		 = CONTROLMODE_NORMAL
			Player.DrawOrder		 = 4
			Player.Priority			 = PRIORITY_ACTIVE
			Player.Rings			 = 0
			Player.InvincibleTimer	 = 120
			Player.BlinkTimer		 = 3
			Screen.CameraEnabled	 = true
			Screen.AdjustCameraY	 = 0
			TempValue3 >>= 16
			TempValue3 -= Screen.CenterX
			Screen.XOffset = TempValue3
			TempValue4 >>= 16
			TempValue4 -= Screen.CenterY
			Screen.YOffset = TempValue4
		end if
	end if
end function

// Used by badniks`;

export const patches: ScriptPatch[] = [
  {
    file: "R1/Ramp3D.txt",
    reason: "load the interacting player's ramp origin rather than the partner's last position",
    find: "sub ObjectPlayerInteraction",
    replace: `sub ObjectPlayerInteraction
	if Stage.PlayerCount > 1
		if Stage.ActivePlayer == 0
			Player.XOriginPos = Object.Value2
		else
			Player.XOriginPos = Object.Value3
		end if
	end if`,
  },
  {
    file: "R1/Ramp3D.txt",
    reason: "retain separate ramp and drop origins for the two co-op players",
    find: "\tend switch\nend sub\n\n\nsub ObjectStartup",
    replace: `	end switch
	if Stage.PlayerCount > 1
		if Stage.ActivePlayer == 0
			Object.Value2 = Player.XOriginPos
		else
			Object.Value3 = Player.XOriginPos
		end if
	end if
end sub


sub ObjectStartup`,
  },
  {
    file: "Global/SignPost.txt",
    reason: "let either co-op player activate the goal and retain that player for the finish sequence",
    find: "sub ObjectMain\n\tswitch Object.State",
    replace: `sub ObjectMain
	if Stage.PlayerCount > 1
		if Object.State == SIGNPOST_IDLE
			Object.Value2 = 0
			if Player.XPos <= Object.XPos
				Stage.ActivePlayer = 1
				TempValue0 = Object.YPos
				TempValue0 += 0x600000
				if Player.YPos < TempValue0
					if Player.XPos > Object.XPos
						Object.Value2 = 1
					end if
				end if
			end if
		end if
		Stage.ActivePlayer = Object.Value2
	end if
	switch Object.State`,
  },
  {
    file: "Global/SignPost.txt",
    reason: "check the finishing player's entity after the sign stops spinning",
    find: "\t\t\t\t\tif Object[0].Type == TypeName[Blank Object]",
    replace: "\t\t\t\t\tArrayPos1 = Player.EntityNo\n\t\t\t\t\tif Object[ArrayPos1].Type == TypeName[Blank Object]",
  },
  {
    file: "Global/SignPost.txt",
    reason: "check the finishing player's entity while moving them offscreen",
    find: "\t\tif Object[0].Type == TypeName[Blank Object]",
    replace: "\t\tArrayPos1 = Player.EntityNo\n\t\tif Object[ArrayPos1].Type == TypeName[Blank Object]",
  },
  {
    file: "R1/TubeSwitch.txt",
    reason: "load each co-op player's tube contact latch and exit velocity",
    find: "sub ObjectPlayerInteraction",
    replace: `sub ObjectPlayerInteraction
	if Stage.PlayerCount > 1
		if Stage.ActivePlayer == 0
			Object.OnObject = Object.Value3
			Object.LaunchSpeed = Object.Value5
		else
			Object.OnObject = Object.Value4
			Object.LaunchSpeed = Object.Value6
		end if
	end if`,
  },
  {
    file: "R1/TubeSwitch.txt",
    reason: "save tube contact and launch state without the other player clearing it",
    find: "\t\tObject.OnObject = false\n\tend if\nend sub",
    replace: `		Object.OnObject = false
	end if
	if Stage.PlayerCount > 1
		if Stage.ActivePlayer == 0
			Object.Value3 = Object.OnObject
			Object.Value5 = Object.LaunchSpeed
		else
			Object.Value4 = Object.OnObject
			Object.Value6 = Object.LaunchSpeed
		end if
	end if
end sub`,
  },
  {
    file: "R1/TubeSwitch.txt",
    reason: "arm and release the angled tube exit separately for each co-op player",
    find: `		case EXIT_ANGLE_TUBE
			if Player.State == Player_State_TubeRoll
				Object.PropertyValue = EXIT_BOOST_TUBE
			end if`,
    replace: `		case EXIT_ANGLE_TUBE
			if Stage.PlayerCount > 1
				GetBit(TempValue0, Object.Value7, Stage.ActivePlayer)
				if TempValue0 == true
					if Player.Gravity == GRAVITY_AIR
						Player.YVelocity = -0xA8000
						SetBit(Object.Value7, Stage.ActivePlayer, false)
					end if
				else
					if Player.State == Player_State_TubeRoll
						SetBit(Object.Value7, Stage.ActivePlayer, true)
					end if
				end if
			else
				if Player.State == Player_State_TubeRoll
					Object.PropertyValue = EXIT_BOOST_TUBE
				end if
			end if`,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "declare the co-op player setup and respawn functions",
    find: "#function Player_Setup_Startup",
    replace: "#function Player_Setup_Startup\n#function Player_Setup_One\n#function Player_CoopRespawn",
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "the player setup becomes a function that ends the startup sub's loop body",
    find: `			ResetObjectEntity(ArrayPos0, TypeName[Blank Object], 0, 0, 0)
		end if

		ArrayPos0++
	loop
#endplatform
end sub`,
    replace: `#endplatform
end function`,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "set up one player per call, so a second one can be spawned (entity 5)",
    find: `#platform: Use_Standalone
	ArrayPos0 = 32
	while ArrayPos0 < 1056
		if Object[ArrayPos0].Type == TypeName[Player Object]
			switch Stage.PlayerListPos
			case PLAYER_SONIC_A
				ResetObjectEntity(0, TypeName[Player Object], 0, Object[ArrayPos0].XPos, Object[ArrayPos0].YPos)
				Player.XPos = Object[ArrayPos0].XPos
				Player.YPos = Object[ArrayPos0].YPos

				LoadAnimation("Sonic.Ani")
				BindPlayerToObject(0, 0)`,
    replace: SETUP_LOOP,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "player 2 may be Tails too",
    find: `			case PLAYER_TAILS_A
				ResetObjectEntity(0, TypeName[Player Object], 0, Object[ArrayPos0].XPos, Object[ArrayPos0].YPos)
				Player.XPos = Object[ArrayPos0].XPos
				Player.YPos = Object[ArrayPos0].YPos

				LoadAnimation("Tails.Ani")
				BindPlayerToObject(0, 0)`,
    replace: SETUP_TAILS,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "add the co-op respawn function",
    find: "\n// Used by badniks",
    replace: COOP_RESPAWN,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "respawn at the checkpoint instead of ending the act",
    find: `		Player.Animation = ANI_DYING
	end if

	if Player.YVelocity > 0x100000`,
    replace: `		Player.Animation = ANI_DYING
	end if

	TempValue0 = 0x100000
	CallFunction(Player_CoopRespawn)

	if Player.YVelocity > 0x100000`,
  },
  {
    file: "Players/PlayerObject.txt",
    reason: "respawn at the checkpoint after drowning",
    find: `	Player.Animation   = ANI_DROWNING

	if Player.YVelocity > 0x80000`,
    replace: `	Player.Animation   = ANI_DROWNING

	TempValue0 = 0x80000
	CallFunction(Player_CoopRespawn)

	if Player.YVelocity > 0x80000`,
  },
  {
    file: "Global/HUD.txt",
    reason: "preload both characters' HUD sheets for co-op",
    find: `sub ObjectStartup
	// Standard Platforms and Mobile Platforms have different drawing routines`,
    replace: `sub ObjectStartup
	if Stage.PlayerCount > 1
		LoadSpriteSheet("Global/Display.gif")
		LoadSpriteSheet("Global/Display_t.gif")
	end if
	// Standard Platforms and Mobile Platforms have different drawing routines`,
  },
  {
    file: "Global/HUD.txt",
    reason: "draw each view's lives icon with its own character's HUD sheet",
    find: `sub ObjectDraw`,
    replace: `sub ObjectDraw
	if Stage.PlayerCount > 1
		if Stage.PlayerListPos == PLAYER_TAILS_A
			LoadSpriteSheet("Global/Display_t.gif")
		else
			LoadSpriteSheet("Global/Display.gif")
		end if
	end if`,
  },
  {
    file: "Players/TailsObject.txt",
    reason: "a second tail object for a Tails player 2",
    find: `sub ObjectMain
	ArrayPos0 = Player.DrawOrder
	Screen[ArrayPos0].DrawListSize = 2
	GetDrawListEntityRef(TempValue0, ArrayPos0, 0)
	SetDrawListEntityRef(Object.EntityNo, ArrayPos0, 0)
	SetDrawListEntityRef(TempValue0, ArrayPos0, 1)
end sub`,
    replace: `sub ObjectMain
	ArrayPos0 = Player.DrawOrder
	if Object.EntityNo == 6
		// Player 2's tail goes in front of player 2's entry, which is the last one of the list
		TempValue1 = Screen[ArrayPos0].DrawListSize
		TempValue2 = TempValue1
		TempValue2--
		GetDrawListEntityRef(TempValue0, ArrayPos0, TempValue2)
		SetDrawListEntityRef(Object.EntityNo, ArrayPos0, TempValue2)
		SetDrawListEntityRef(TempValue0, ArrayPos0, TempValue1)
		TempValue1++
		Screen[ArrayPos0].DrawListSize = TempValue1
	else
		Screen[ArrayPos0].DrawListSize = 2
		GetDrawListEntityRef(TempValue0, ArrayPos0, 0)
		SetDrawListEntityRef(Object.EntityNo, ArrayPos0, 0)
		SetDrawListEntityRef(TempValue0, ArrayPos0, 1)
	end if
end sub`,
  },
  {
    file: "Players/TailsObject.txt",
    reason: "spawn a tail for each player that is Tails",
    find: `sub ObjectStartup
	if Stage.PlayerListPos == PLAYER_TAILS_A // PLAYER_TAILS in origins
		LoadSpriteSheet("Players/Tails1.gif")

		Object[1].Type = TypeName[Tails Object]
		TailsObject.DrawOrder = 8
		TailsObject.Priority  = PRIORITY_ACTIVE
`,
    replace: `sub ObjectStartup
	TempValue0 = false
	TempValue1 = false
	if Stage.PlayerListPos == PLAYER_TAILS_A // PLAYER_TAILS in origins
		TempValue0 = true
	end if
	if Stage.PlayerCount > 1
		Stage.ActivePlayer = 1
		if Stage.PlayerListPos == PLAYER_TAILS_A
			TempValue1 = true
		end if
		Stage.ActivePlayer = 0
	end if
	TempValue2  = TempValue0
	TempValue2 |= TempValue1

	if TempValue2 == true
		LoadSpriteSheet("Players/Tails1.gif")

		if TempValue0 == true
			Object[1].Type = TypeName[Tails Object]
			TailsObject.DrawOrder = 8
			TailsObject.Priority  = PRIORITY_ACTIVE
		end if

		if TempValue1 == true
			Object[6].Type = TypeName[Tails Object]
			Object[6].DrawOrder = 8
			Object[6].Priority  = PRIORITY_ACTIVE
		end if
`,
  },
];
