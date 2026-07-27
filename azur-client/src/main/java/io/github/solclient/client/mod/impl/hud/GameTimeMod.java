/*
 * Sol Client - an open source Minecraft client
 * Copyright (C) 2021-2026  TheKodeToad and Contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

package io.github.solclient.client.mod.impl.hud;

import io.github.solclient.client.mod.impl.SolClientSimpleHudMod;
import io.github.solclient.client.mod.impl.core.mixins.LevelPropertiesAccessor;

/**
 * Game time HUD (Azur Client) - displays the in-game time of day as a clock
 * (the Clock mod shows real time; this one shows Minecraft time).
 */
public final class GameTimeMod extends SolClientSimpleHudMod {

	@Override
	public String getText(boolean editMode) {
		long time;
		if (editMode || mc.world == null)
			time = 8500;
		else
			// champ brut (accessor) : insensible au mod Time Changer, comme le compteur de jours
			time = ((LevelPropertiesAccessor) mc.world.getLevelProperties()).azur$getRawTimeOfDay() % 24000;

		long hours = (time / 1000 + 6) % 24;
		long minutes = time % 1000 * 60 / 1000;
		return String.format("%02d:%02d", hours, minutes);
	}

}
