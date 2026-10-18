// Scene.cpp camera functions (SetPlayerScreenPosition and friends). They operate on the current camera: the
// engine selects each player's camera in turn before calling them.
/* eslint-disable */
import type { Engine } from "./engine.js";
import type { Entity } from "./entity.js";
import { SCREEN_YSIZE, SCREEN_SCROLL_UP, SCREEN_SCROLL_DOWN, CAMERASTYLE_EXTENDED_OFFSET_L, CAMERASTYLE_EXTENDED_OFFSET_R, CAMERASTYLE_EXTENDED, SCREEN_CENTERY } from "./c.js";

export function SetPlayerScreenPosition(E: Engine, target: Entity): void
{
    let targetX = target.xpos >> 16;
    let targetY = E.cameraAdjustY + (target.ypos >> 16);
    if (E.newYBoundary1 > E.curYBoundary1) {
        if (E.newYBoundary1 >= E.yScrollOffset)
            E.curYBoundary1 = E.yScrollOffset;
        else
            E.curYBoundary1 = E.newYBoundary1;
    }
    if (E.newYBoundary1 < E.curYBoundary1) {
        if (E.curYBoundary1 >= E.yScrollOffset)
            --E.curYBoundary1;
        else
            E.curYBoundary1 = E.newYBoundary1;
    }
    if (E.newYBoundary2 < E.curYBoundary2) {
        if (E.curYBoundary2 <= E.yScrollOffset + SCREEN_YSIZE || E.newYBoundary2 >= E.yScrollOffset + SCREEN_YSIZE)
            --E.curYBoundary2;
        else
            E.curYBoundary2 = E.yScrollOffset + SCREEN_YSIZE;
    }
    if (E.newYBoundary2 > E.curYBoundary2) {
        if (E.yScrollOffset + SCREEN_YSIZE >= E.curYBoundary2) {
            ++E.curYBoundary2;
            if (target.yvel > 0) {
                let buf = E.curYBoundary2 + (target.yvel >> 16);
                if (E.newYBoundary2 < buf) {
                    E.curYBoundary2 = E.newYBoundary2;
                }
                else {
                    E.curYBoundary2 += target.yvel >> 16;
                }
            }
        }
        else
            E.curYBoundary2 = E.newYBoundary2;
    }
    if (E.newXBoundary1 > E.curXBoundary1) {
        if (E.xScrollOffset <= E.newXBoundary1)
            E.curXBoundary1 = E.xScrollOffset;
        else
            E.curXBoundary1 = E.newXBoundary1;
    }
    if (E.newXBoundary1 < E.curXBoundary1) {
        if (E.xScrollOffset <= E.curXBoundary1) {
            --E.curXBoundary1;
            if (target.xvel < 0) {
                E.curXBoundary1 += target.xvel >> 16;
                if (E.curXBoundary1 < E.newXBoundary1)
                    E.curXBoundary1 = E.newXBoundary1;
            }
        }
        else {
            E.curXBoundary1 = E.newXBoundary1;
        }
    }
    if (E.newXBoundary2 < E.curXBoundary2) {
        if (E.newXBoundary2 > E.SCREEN_XSIZE + E.xScrollOffset)
            E.curXBoundary2 = E.newXBoundary2;
        else
            E.curXBoundary2 = E.SCREEN_XSIZE + E.xScrollOffset;
    }
    if (E.newXBoundary2 > E.curXBoundary2) {
        if (E.SCREEN_XSIZE + E.xScrollOffset >= E.curXBoundary2) {
            ++E.curXBoundary2;
            if (target.xvel > 0) {
                E.curXBoundary2 += target.xvel >> 16;
                if (E.curXBoundary2 > E.newXBoundary2)
                    E.curXBoundary2 = E.newXBoundary2;
            }
        }
        else {
            E.curXBoundary2 = E.newXBoundary2;
        }
    }

    let xPosDif = targetX - E.cameraXPos;
    if (targetX > E.cameraXPos) {
        xPosDif -= 8;
        if (xPosDif >= 0) {
            if (xPosDif >= 17)
                xPosDif = 16;
        }
        else {
            xPosDif = 0;
        }
    }
    else {
        xPosDif += 8;
        if (xPosDif > 0) {
            xPosDif = 0;
        }
        else if (xPosDif <= -17) {
            xPosDif = -16;
        }
    }

    let centeredXBound1 = E.cameraXPos + xPosDif;
    E.cameraXPos          = centeredXBound1;
    if (centeredXBound1 < E.SCREEN_CENTERX + E.curXBoundary1) {
        E.cameraXPos      = E.SCREEN_CENTERX + E.curXBoundary1;
        centeredXBound1 = E.SCREEN_CENTERX + E.curXBoundary1;
    }

    let centeredXBound2 = E.curXBoundary2 - E.SCREEN_CENTERX;
    if (centeredXBound2 < centeredXBound1) {
        E.cameraXPos      = centeredXBound2;
        centeredXBound1 = centeredXBound2;
    }

    let yPosDif = 0;
    if (target.scrollTracking) {
        if (targetY <= E.cameraYPos) {
            yPosDif = (targetY - E.cameraYPos) + 32;
            if (yPosDif <= 0) {
                if (yPosDif <= -17)
                    yPosDif = -16;
            }
            else
                yPosDif = 0;
        }
        else {
            yPosDif = (targetY - E.cameraYPos) - 32;
            if (yPosDif >= 0) {
                if (yPosDif >= 17)
                    yPosDif = 16;
            }
            else
                yPosDif = 0;
        }
        E.cameraLockedY = 0;
    }
    else if (E.cameraLockedY) {
        yPosDif    = 0;
        E.cameraYPos = targetY;
    }
    else if (targetY <= E.cameraYPos) {
        yPosDif = targetY - E.cameraYPos;
        if (targetY - E.cameraYPos <= 0) {
            if (yPosDif >= -32 && Math.abs(target.yvel) <= 0x60000) {
                if (yPosDif < -6) {
                    yPosDif = -6;
                }
            }
            else if (yPosDif < -16) {
                yPosDif = -16;
            }
        }
        else {
            yPosDif       = 0;
            E.cameraLockedY = 1;
        }
    }
    else {
        yPosDif = targetY - E.cameraYPos;
        if (targetY - E.cameraYPos < 0) {
            yPosDif       = 0;
            E.cameraLockedY = 1;
        }
        else if (yPosDif > 32 || Math.abs(target.yvel) > 0x60000) {
            if (yPosDif > 16) {
                yPosDif = 16;
            }
            else {
                E.cameraLockedY = 1;
            }
        }
        else {
            if (yPosDif <= 6) {
                E.cameraLockedY = 1;
            }
            else {
                yPosDif = 6;
            }
        }
    }

    let newCamY = E.cameraYPos + yPosDif;
    if (newCamY <= E.curYBoundary1 + (SCREEN_SCROLL_UP - 1))
        newCamY = E.curYBoundary1 + SCREEN_SCROLL_UP;
    E.cameraYPos = newCamY;
    if (E.curYBoundary2 - (SCREEN_SCROLL_DOWN - 1) <= newCamY) {
        E.cameraYPos = E.curYBoundary2 - SCREEN_SCROLL_DOWN;
    }

    E.xScrollOffset = E.cameraShakeX + centeredXBound1 - E.SCREEN_CENTERX;

    let pos = E.cameraYPos + target.lookPosY - SCREEN_SCROLL_UP;
    if (pos < E.curYBoundary1) {
        E.yScrollOffset = E.curYBoundary1;
    }
    else {
        E.yScrollOffset = E.cameraYPos + target.lookPosY - SCREEN_SCROLL_UP;
    }

    let y = E.curYBoundary2 - SCREEN_YSIZE;
    if (E.curYBoundary2 - (SCREEN_YSIZE - 1) > E.yScrollOffset)
        y = E.yScrollOffset;
    E.yScrollOffset = E.cameraShakeY + y;

    if (E.cameraShakeX) {
        if (E.cameraShakeX <= 0) {
            E.cameraShakeX = ~E.cameraShakeX;
        }
        else {
            E.cameraShakeX = -E.cameraShakeX;
        }
    }

    if (E.cameraShakeY) {
        if (E.cameraShakeY <= 0) {
            E.cameraShakeY = ~E.cameraShakeY;
        }
        else {
            E.cameraShakeY = -E.cameraShakeY;
        }
    }
}
export function SetPlayerScreenPositionCDStyle(E: Engine, target: Entity): void
{
    let targetX = target.xpos >> 16;
    let targetY = E.cameraAdjustY + (target.ypos >> 16);
    if (E.newYBoundary1 > E.curYBoundary1) {
        if (E.newYBoundary1 >= E.yScrollOffset)
            E.curYBoundary1 = E.yScrollOffset;
        else
            E.curYBoundary1 = E.newYBoundary1;
    }
    if (E.newYBoundary1 < E.curYBoundary1) {
        if (E.curYBoundary1 >= E.yScrollOffset)
            --E.curYBoundary1;
        else
            E.curYBoundary1 = E.newYBoundary1;
    }
    if (E.newYBoundary2 < E.curYBoundary2) {
        if (E.curYBoundary2 <= E.yScrollOffset + SCREEN_YSIZE || E.newYBoundary2 >= E.yScrollOffset + SCREEN_YSIZE)
            --E.curYBoundary2;
        else
            E.curYBoundary2 = E.yScrollOffset + SCREEN_YSIZE;
    }
    if (E.newYBoundary2 > E.curYBoundary2) {
        if (E.yScrollOffset + SCREEN_YSIZE >= E.curYBoundary2) {
            ++E.curYBoundary2;
            if (target.yvel > 0) {
                let buf = E.curYBoundary2 + (target.yvel >> 16);
                if (E.newYBoundary2 < buf) {
                    E.curYBoundary2 = E.newYBoundary2;
                }
                else {
                    E.curYBoundary2 += target.yvel >> 16;
                }
            }
        }
        else
            E.curYBoundary2 = E.newYBoundary2;
    }
    if (E.newXBoundary1 > E.curXBoundary1) {
        if (E.xScrollOffset <= E.newXBoundary1)
            E.curXBoundary1 = E.xScrollOffset;
        else
            E.curXBoundary1 = E.newXBoundary1;
    }
    if (E.newXBoundary1 < E.curXBoundary1) {
        if (E.xScrollOffset <= E.curXBoundary1) {
            --E.curXBoundary1;
            if (target.xvel < 0) {
                E.curXBoundary1 += target.xvel >> 16;
                if (E.curXBoundary1 < E.newXBoundary1)
                    E.curXBoundary1 = E.newXBoundary1;
            }
        }
        else {
            E.curXBoundary1 = E.newXBoundary1;
        }
    }
    if (E.newXBoundary2 < E.curXBoundary2) {
        if (E.newXBoundary2 > E.SCREEN_XSIZE + E.xScrollOffset)
            E.curXBoundary2 = E.newXBoundary2;
        else
            E.curXBoundary2 = E.SCREEN_XSIZE + E.xScrollOffset;
    }
    if (E.newXBoundary2 > E.curXBoundary2) {
        if (E.SCREEN_XSIZE + E.xScrollOffset >= E.curXBoundary2) {
            ++E.curXBoundary2;
            if (target.xvel > 0) {
                E.curXBoundary2 += target.xvel >> 16;
                if (E.curXBoundary2 > E.newXBoundary2)
                    E.curXBoundary2 = E.newXBoundary2;
            }
        }
        else {
            E.curXBoundary2 = E.newXBoundary2;
        }
    }

    if (!target.gravity) {
        if (target.direction) {
            if (E.cameraStyle == CAMERASTYLE_EXTENDED_OFFSET_R || target.speed < -0x5F5C2) {
                E.cameraShift = 2;
                if (target.lookPosX <= 63) {
                    target.lookPosX += 2;
                }
            }
            else {
                E.cameraShift = 0;
                if (target.lookPosX < 0) {
                    target.lookPosX += 2;
                }

                if (target.lookPosX > 0) {
                    target.lookPosX -= 2;
                }
            }
        }
        else {
            if (E.cameraStyle == CAMERASTYLE_EXTENDED_OFFSET_L || target.speed > 0x5F5C2) {
                E.cameraShift = 1;
                if (target.lookPosX >= -63) {
                    target.lookPosX -= 2;
                }
            }
            else {
                E.cameraShift = 0;
                if (target.lookPosX < 0) {
                    target.lookPosX += 2;
                }

                if (target.lookPosX > 0) {
                    target.lookPosX -= 2;
                }
            }
        }
    }
    else {
        if (E.cameraShift == 1) {
            if (target.lookPosX >= -63) {
                target.lookPosX -= 2;
            }
        }
        else if (E.cameraShift < 1) {
            if (target.lookPosX < 0) {
                target.lookPosX += 2;
            }
            if (target.lookPosX > 0) {
                target.lookPosX -= 2;
            }
        }
        else if (E.cameraShift == 2) {
            if (target.lookPosX <= 63) {
                target.lookPosX += 2;
            }
        }
    }
    E.cameraXPos = targetX - target.lookPosX;

    if (!target.scrollTracking) {
        if (E.cameraLockedY) {
            E.cameraYPos = targetY;
            if (E.cameraYPos < E.curYBoundary1 + SCREEN_SCROLL_UP) {
                E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
            }
        }
        else if (targetY > E.cameraYPos) {
            let dif = targetY - E.cameraYPos;
            if (targetY - E.cameraYPos < 0) {
                E.cameraLockedY = 1;
                if (E.cameraYPos < E.curYBoundary1 + SCREEN_SCROLL_UP) {
                    E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                }
            }
            else {
                if (dif > 32 || Math.abs(target.yvel) > 0x60000) {
                    if (dif > 16) {
                        dif = 16;
                        if (E.cameraYPos + dif >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                            E.cameraYPos += dif;
                        }
                        else {
                            E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                        }
                    }
                    else {
                        E.cameraLockedY = 1;
                        if (E.cameraYPos + dif >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                            E.cameraYPos += dif;
                        }
                        else {
                            E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                        }
                    }
                }
                else if (dif > 6) {
                    dif = 6;
                    if (E.cameraYPos + dif >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                        E.cameraYPos += dif;
                    }
                    else {
                        E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                    }
                }
                else {
                    E.cameraLockedY = 1;
                    if (E.cameraYPos + dif >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                        E.cameraYPos += dif;
                    }
                    else {
                        E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                    }
                }
            }
        }
        else {
            let dif = targetY - E.cameraYPos;
            if (targetY - E.cameraYPos <= 0) {
                if (dif < -32 || Math.abs(target.yvel) > 0x60000) {
                    if (dif < -16) {
                        dif = -16;
                        if (E.cameraYPos + dif >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                            E.cameraYPos += dif;
                        }
                        else {
                            E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                        }
                    }
                    else {
                        E.cameraLockedY = 1;
                        if (E.cameraYPos + dif >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                            E.cameraYPos += dif;
                        }
                        else {
                            E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                        }
                    }
                }
                else if (dif < -6) {
                    dif = -6;
                    if (E.cameraYPos + dif >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                        E.cameraYPos += dif;
                    }
                    else {
                        E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                    }
                }
            }
            else {
                dif = 0;
                if (Math.abs(target.yvel) > 0x60000) {
                    E.cameraLockedY = 1;
                    if (E.cameraYPos + dif >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                        E.cameraYPos += dif;
                    }
                    else {
                        E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                    }
                }
                else {
                    E.cameraLockedY = 1;
                    if (E.cameraYPos + dif >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                        E.cameraYPos += dif;
                    }
                    else {
                        E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                    }
                }
            }
        }
    }
    else {
        let dif = targetY - E.cameraYPos;
        let difY = 0;
        if (targetY > E.cameraYPos) {
            difY = dif - 32;
            if (difY >= 0) {
                if (difY >= 17)
                    difY = 16;

                E.cameraLockedY = 0;
                if (E.cameraYPos + difY >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                    E.cameraYPos += difY;
                }
                else {
                    E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                }
            }
            else {
                E.cameraLockedY = 0;
                if (E.cameraYPos < E.curYBoundary1 + SCREEN_SCROLL_UP) {
                    E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                }
            }
        }
        else {
            difY = dif + 32;
            if (difY > 0) {
                difY = 0;

                E.cameraLockedY = 0;
                if (E.cameraYPos < E.curYBoundary1 + SCREEN_SCROLL_UP) {
                    E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                }
            }
            else if (difY <= -17) {
                difY = -16;

                E.cameraLockedY = 0;
                if (E.cameraYPos + difY >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                    E.cameraYPos += difY;
                }
                else {
                    E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                }
            }
            else {
                E.cameraLockedY = 0;
                if (E.cameraYPos + difY >= E.curYBoundary1 + SCREEN_SCROLL_UP) {
                    E.cameraYPos += difY;
                }
                else {
                    E.cameraYPos = E.curYBoundary1 + SCREEN_SCROLL_UP;
                }
            }
        }
    }

    if (E.cameraYPos >= E.curYBoundary2 - SCREEN_SCROLL_DOWN - 1) {
        E.cameraYPos = E.curYBoundary2 - SCREEN_SCROLL_DOWN;
    }

    E.xScrollOffset = E.cameraXPos - E.SCREEN_CENTERX;
    E.yScrollOffset = target.lookPosY + E.cameraYPos - SCREEN_SCROLL_UP;

    let x = E.curXBoundary1;
    if (x <= E.xScrollOffset)
        x = E.xScrollOffset;
    else
        E.xScrollOffset = x;

    if (x > E.curXBoundary2 - E.SCREEN_XSIZE) {
        x             = E.curXBoundary2 - E.SCREEN_XSIZE;
        E.xScrollOffset = E.curXBoundary2 - E.SCREEN_XSIZE;
    }

    let y = E.curYBoundary1;
    if (E.yScrollOffset >= y)
        y = E.yScrollOffset;
    else
        E.yScrollOffset = y;

    if (E.curYBoundary2 - SCREEN_YSIZE - 1 <= y)
        y = E.curYBoundary2 - SCREEN_YSIZE;

    E.xScrollOffset = E.cameraShakeX + x;
    E.yScrollOffset = E.cameraShakeY + y;

    if (E.cameraShakeX) {
        if (E.cameraShakeX <= 0) {
            E.cameraShakeX = ~E.cameraShakeX;
        }
        else {
            E.cameraShakeX = -E.cameraShakeX;
        }
    }

    if (E.cameraShakeY) {
        if (E.cameraShakeY <= 0) {
            E.cameraShakeY = ~E.cameraShakeY;
        }
        else {
            E.cameraShakeY = -E.cameraShakeY;
        }
    }
}
export function SetPlayerHLockedScreenPosition(E: Engine, target: Entity): void
{
    let targetY = E.cameraAdjustY + (target.ypos >> 16);

    if (E.newYBoundary1 <= E.curYBoundary1) {
        if (E.curYBoundary1 > E.yScrollOffset)
            --E.curYBoundary1;
        else
            E.curYBoundary1 = E.newYBoundary1;
    }
    else {
        if (E.newYBoundary1 >= E.yScrollOffset)
            E.curYBoundary1 = E.yScrollOffset;
        else
            E.curYBoundary1 = E.newYBoundary1;
    }

    if (E.newYBoundary2 < E.curYBoundary2) {
        if (E.curYBoundary2 <= E.yScrollOffset + SCREEN_YSIZE || E.newYBoundary2 >= E.yScrollOffset + SCREEN_YSIZE)
            --E.curYBoundary2;
        else
            E.curYBoundary2 = E.yScrollOffset + SCREEN_YSIZE;
    }
    if (E.newYBoundary2 > E.curYBoundary2) {
        if (E.yScrollOffset + SCREEN_YSIZE >= E.curYBoundary2) {
            ++E.curYBoundary2;
            if (target.yvel > 0) {
                if (E.newYBoundary2 < E.curYBoundary2 + (target.yvel >> 16)) {
                    E.curYBoundary2 = E.newYBoundary2;
                }
                else {
                    E.curYBoundary2 += target.yvel >> 16;
                }
            }
        }
        else
            E.curYBoundary2 = E.newYBoundary2;
    }

    if (E.newXBoundary1 > E.curXBoundary1) {
        if (E.xScrollOffset <= E.newXBoundary1)
            E.curXBoundary1 = E.xScrollOffset;
        else
            E.curXBoundary1 = E.newXBoundary1;
    }
    if (E.newXBoundary1 < E.curXBoundary1) {
        if (E.xScrollOffset <= E.curXBoundary1) {
            --E.curXBoundary1;
            if (target.xvel < 0) {
                E.curXBoundary1 += target.xvel >> 16;
                if (E.curXBoundary1 < E.newXBoundary1)
                    E.curXBoundary1 = E.newXBoundary1;
            }
        }
        else {
            E.curXBoundary1 = E.newXBoundary1;
        }
    }
    if (E.newXBoundary2 < E.curXBoundary2) {
        if (E.newXBoundary2 > E.SCREEN_XSIZE + E.xScrollOffset)
            E.curXBoundary2 = E.newXBoundary2;
        else
            E.curXBoundary2 = E.SCREEN_XSIZE + E.xScrollOffset;
    }
    if (E.newXBoundary2 > E.curXBoundary2) {
        if (E.SCREEN_XSIZE + E.xScrollOffset >= E.curXBoundary2) {
            ++E.curXBoundary2;
            if (target.xvel > 0) {
                E.curXBoundary2 += target.xvel >> 16;
                if (E.curXBoundary2 > E.newXBoundary2)
                    E.curXBoundary2 = E.newXBoundary2;
            }
        }
        else {
            E.curXBoundary2 = E.newXBoundary2;
        }
    }

    let camScroll = 0;
    if (target.scrollTracking) {
        if (targetY <= E.cameraYPos) {
            camScroll = targetY - E.cameraYPos + 32;
            if (camScroll <= 0) {
                if (camScroll <= -17)
                    camScroll = -16;
            }
            else
                camScroll = 0;
        }
        else {
            camScroll = targetY - E.cameraYPos - 32;
            if (camScroll >= 0) {
                if (camScroll >= 17)
                    camScroll = 16;
            }
            else
                camScroll = 0;
        }
        E.cameraLockedY = 0;
    }
    else if (E.cameraLockedY) {
        camScroll = 0;
        E.cameraYPos = targetY;
    }
    else if (targetY > E.cameraYPos) {
        camScroll = targetY - E.cameraYPos;
        if (camScroll >= 0) {
            if (camScroll > 32 || Math.abs(target.yvel) > 0x60000) {
                if (camScroll > 16) {
                    camScroll = 16;
                }
                else {
                    E.cameraLockedY = 1;
                }
            }
            else if (camScroll > 6) {
                camScroll = 6;
            }
            else {
                E.cameraLockedY = 1;
            }
        }
        else {
            camScroll     = 0;
            E.cameraLockedY = 1;
        }
    }
    else {
        camScroll = targetY - E.cameraYPos;
        if (camScroll > 0) {
            camScroll     = 0;
            E.cameraLockedY = 1;
        }
        else if (camScroll < -32 || Math.abs(target.yvel) > 0x60000) {
            if (camScroll < -16) {
                camScroll = -16;
            }
            else {
                E.cameraLockedY = 1;
            }
        }
        else {
            if (camScroll >= -6)
                E.cameraLockedY = 1;
            else
                camScroll = -6;
        }
    }

    let newCamY = E.cameraYPos + camScroll;
    if (newCamY <= E.curYBoundary1 + (SCREEN_SCROLL_UP - 1))
        newCamY = E.curYBoundary1 + SCREEN_SCROLL_UP;
    E.cameraYPos = newCamY;
    if (E.curYBoundary2 - (SCREEN_SCROLL_DOWN - 1) <= newCamY) {
        newCamY    = E.curYBoundary2 - SCREEN_SCROLL_DOWN;
        E.cameraYPos = E.curYBoundary2 - SCREEN_SCROLL_DOWN;
    }

    E.xScrollOffset = E.cameraShakeX + E.cameraXPos - E.SCREEN_CENTERX;

    let pos = newCamY + target.lookPosY - SCREEN_SCROLL_UP;
    if (pos < E.curYBoundary1) {
        E.yScrollOffset = E.curYBoundary1;
    }
    else {
        E.yScrollOffset = newCamY + target.lookPosY - SCREEN_SCROLL_UP;
    }
    let y1 = E.curYBoundary2 - (SCREEN_YSIZE - 1);
    let y2 = E.curYBoundary2 - SCREEN_YSIZE;
    if (y1 > E.yScrollOffset)
        y2 = E.yScrollOffset;
    E.yScrollOffset = E.cameraShakeY + y2;

    if (E.cameraShakeX) {
        if (E.cameraShakeX <= 0) {
            E.cameraShakeX = ~E.cameraShakeX;
        }
        else {
            E.cameraShakeX = -E.cameraShakeX;
        }
    }

    if (E.cameraShakeY) {
        if (E.cameraShakeY <= 0) {
            E.cameraShakeY = ~E.cameraShakeY;
        }
        else {
            E.cameraShakeY = -E.cameraShakeY;
        }
    }
}
export function SetPlayerLockedScreenPosition(E: Engine, target: Entity): void
{
    if (E.newYBoundary1 > E.curYBoundary1) {
        if (E.yScrollOffset <= E.newYBoundary1)
            E.curYBoundary1 = E.yScrollOffset;
        else
            E.curYBoundary1 = E.newYBoundary1;
    }
    if (E.newYBoundary1 < E.curYBoundary1) {
        if (E.yScrollOffset <= E.curYBoundary1)
            --E.curYBoundary1;
        else
            E.curYBoundary1 = E.newYBoundary1;
    }
    if (E.newYBoundary2 < E.curYBoundary2) {
        if (E.curYBoundary2 <= E.yScrollOffset + SCREEN_YSIZE || E.newYBoundary2 >= E.yScrollOffset + SCREEN_YSIZE)
            --E.curYBoundary2;
        else
            E.curYBoundary2 = E.yScrollOffset + SCREEN_YSIZE;
    }
    if (E.newYBoundary2 > E.curYBoundary2) {
        if (E.yScrollOffset + SCREEN_YSIZE >= E.curYBoundary2)
            ++E.curYBoundary2;
        else
            E.curYBoundary2 = E.newYBoundary2;
    }
    if (E.newXBoundary1 > E.curXBoundary1) {
        if (E.xScrollOffset <= E.newXBoundary1)
            E.curXBoundary1 = E.xScrollOffset;
        else
            E.curXBoundary1 = E.newXBoundary1;
    }
    if (E.newXBoundary1 < E.curXBoundary1) {
        if (E.xScrollOffset <= E.curXBoundary1) {
            --E.curXBoundary1;
            if (target.xvel < 0) {
                E.curXBoundary1 += target.xvel >> 16;
                if (E.curXBoundary1 < E.newXBoundary1)
                    E.curXBoundary1 = E.newXBoundary1;
            }
        }
        else {
            E.curXBoundary1 = E.newXBoundary1;
        }
    }
    if (E.newXBoundary2 < E.curXBoundary2) {
        if (E.newXBoundary2 > E.SCREEN_XSIZE + E.xScrollOffset)
            E.curXBoundary2 = E.newXBoundary2;
        else
            E.curXBoundary2 = E.SCREEN_XSIZE + E.xScrollOffset;
    }
    if (E.newXBoundary2 > E.curXBoundary2) {
        if (E.SCREEN_XSIZE + E.xScrollOffset >= E.curXBoundary2) {
            ++E.curXBoundary2;
            if (target.xvel > 0) {
                E.curXBoundary2 += target.xvel >> 16;
                if (E.curXBoundary2 > E.newXBoundary2)
                    E.curXBoundary2 = E.newXBoundary2;
            }
        }
        else {
            E.curXBoundary2 = E.newXBoundary2;
        }
    }

    if (E.cameraShakeX) {
        if (E.cameraShakeX <= 0) {
            E.cameraShakeX = ~E.cameraShakeX;
        }
        else {
            E.cameraShakeX = -E.cameraShakeX;
        }
    }

    if (E.cameraShakeY) {
        if (E.cameraShakeY <= 0) {
            E.cameraShakeY = ~E.cameraShakeY;
        }
        else {
            E.cameraShakeY = -E.cameraShakeY;
        }
    }
}
// Completely unused in both Sonic 1 & Sonic 2
export function SetPlayerScreenPositionFixed(E: Engine, target: Entity): void
{
    let targetX = target.xpos >> 16;
    let targetY = E.cameraAdjustY + (target.ypos >> 16);
    if (E.newYBoundary1 > E.curYBoundary1) {
        if (E.newYBoundary1 >= E.yScrollOffset)
            E.curYBoundary1 = E.yScrollOffset;
        else
            E.curYBoundary1 = E.newYBoundary1;
    }
    if (E.newYBoundary1 < E.curYBoundary1) {
        if (E.curYBoundary1 >= E.yScrollOffset)
            --E.curYBoundary1;
        else
            E.curYBoundary1 = E.newYBoundary1;
    }
    if (E.newYBoundary2 < E.curYBoundary2) {
        if (E.curYBoundary2 <= E.yScrollOffset + SCREEN_YSIZE || E.newYBoundary2 >= E.yScrollOffset + SCREEN_YSIZE)
            --E.curYBoundary2;
        else
            E.curYBoundary2 = E.yScrollOffset + SCREEN_YSIZE;
    }
    if (E.newYBoundary2 > E.curYBoundary2) {
        if (E.yScrollOffset + SCREEN_YSIZE >= E.curYBoundary2) {
            ++E.curYBoundary2;
            if (target.yvel > 0) {
                let buf = E.curYBoundary2 + (target.yvel >> 16);
                if (E.newYBoundary2 < buf) {
                    E.curYBoundary2 = E.newYBoundary2;
                }
                else {
                    E.curYBoundary2 += target.yvel >> 16;
                }
            }
        }
        else
            E.curYBoundary2 = E.newYBoundary2;
    }
    if (E.newXBoundary1 > E.curXBoundary1) {
        if (E.xScrollOffset <= E.newXBoundary1)
            E.curXBoundary1 = E.xScrollOffset;
        else
            E.curXBoundary1 = E.newXBoundary1;
    }
    if (E.newXBoundary1 < E.curXBoundary1) {
        if (E.xScrollOffset <= E.curXBoundary1) {
            --E.curXBoundary1;
            if (target.xvel < 0) {
                E.curXBoundary1 += target.xvel >> 16;
                if (E.curXBoundary1 < E.newXBoundary1)
                    E.curXBoundary1 = E.newXBoundary1;
            }
        }
        else {
            E.curXBoundary1 = E.newXBoundary1;
        }
    }
    if (E.newXBoundary2 < E.curXBoundary2) {
        if (E.newXBoundary2 > E.SCREEN_XSIZE + E.xScrollOffset)
            E.curXBoundary2 = E.newXBoundary2;
        else
            E.curXBoundary2 = E.SCREEN_XSIZE + E.xScrollOffset;
    }
    if (E.newXBoundary2 > E.curXBoundary2) {
        if (E.SCREEN_XSIZE + E.xScrollOffset >= E.curXBoundary2) {
            ++E.curXBoundary2;
            if (target.xvel > 0) {
                E.curXBoundary2 += target.xvel >> 16;
                if (E.curXBoundary2 > E.newXBoundary2)
                    E.curXBoundary2 = E.newXBoundary2;
            }
        }
        else {
            E.curXBoundary2 = E.newXBoundary2;
        }
    }

    E.cameraXPos = targetX;
    if (targetX < E.SCREEN_CENTERX + E.curXBoundary1) {
        targetX    = E.SCREEN_CENTERX + E.curXBoundary1;
        E.cameraXPos = E.SCREEN_CENTERX + E.curXBoundary1;
    }
    let boundX2 = E.curXBoundary2 - E.SCREEN_CENTERX;
    if (boundX2 < targetX) {
        targetX    = boundX2;
        E.cameraXPos = boundX2;
    }

    if (targetY <= E.curYBoundary1 + 119) {
        targetY    = E.curYBoundary1 + 120;
        E.cameraYPos = E.curYBoundary1 + 120;
    }
    else {
        E.cameraYPos = targetY;
    }
    if (E.curYBoundary2 - 119 <= targetY) {
        targetY    = E.curYBoundary2 - 120;
        E.cameraYPos = E.curYBoundary2 - 120;
    }

    E.xScrollOffset = E.cameraShakeX + targetX - E.SCREEN_CENTERX;
    let camY = targetY + target.lookPosY - SCREEN_CENTERY;
    if (E.curYBoundary1 > camY) {
        E.yScrollOffset = E.curYBoundary1;
    }
    else {
        E.yScrollOffset = targetY + target.lookPosY - SCREEN_CENTERY;
    }

    let newCamY = E.curYBoundary2 - SCREEN_YSIZE;
    if (E.curYBoundary2 - (SCREEN_YSIZE - 1) > E.yScrollOffset)
        newCamY = E.yScrollOffset;
    E.yScrollOffset = E.cameraShakeY + newCamY;

    if (E.cameraShakeX) {
        if (E.cameraShakeX <= 0) {
            E.cameraShakeX = ~E.cameraShakeX;
        }
        else {
            E.cameraShakeX = -E.cameraShakeX;
        }
    }

    if (E.cameraShakeY) {
        if (E.cameraShakeY <= 0) {
            E.cameraShakeY = ~E.cameraShakeY;
        }
        else {
            E.cameraShakeY = -E.cameraShakeY;
        }
    }
}
