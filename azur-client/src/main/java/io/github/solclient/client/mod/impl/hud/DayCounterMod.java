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
import net.minecraft.client.resource.language.I18n;

/**
 * Day counter HUD (Azur Client) - displays the current world day (world time /
 * 24000, as shown on the F3 screen).
 */
public final class DayCounterMod extends SolClientSimpleHudMod {

	@Override
	public String getText(boolean editMode) {
		long day;
		if (editMode || mc.world == null)
			day = 128;
		else
			// champ brut (accessor) : la valeur de getTimeOfDay() peut être truquée par
			// le mod Time Changer, ce qui figerait le compteur à « Jour 0 »
			day = ((LevelPropertiesAccessor) mc.world.getLevelProperties()).azur$getRawTimeOfDay() / 24000;

		return I18n.translate("sol_client.mod.day_counter.text", day);
	}

}
