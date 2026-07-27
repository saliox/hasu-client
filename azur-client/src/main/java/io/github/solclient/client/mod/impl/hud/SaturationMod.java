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
import net.minecraft.client.resource.language.I18n;

/**
 * Saturation HUD (Azur Client) - displays hunger and saturation levels, in the
 * style of Lunar Client's Saturation mod.
 */
public final class SaturationMod extends SolClientSimpleHudMod {

	@Override
	public String getText(boolean editMode) {
		int food;
		float saturation;
		if (editMode || mc.player == null) {
			food = 18;
			saturation = 5;
		} else {
			food = mc.player.getHungerManager().getFoodLevel();
			saturation = mc.player.getHungerManager().getSaturationLevel();
		}

		return I18n.translate("sol_client.mod.saturation.text", food, String.format("%.1f", saturation));
	}

}
