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
 * Health HUD (Azur Client) - displays your health as a number (easier to read
 * in a fight than counting hearts).
 */
public final class HealthMod extends SolClientSimpleHudMod {

	@Override
	public String getText(boolean editMode) {
		float health, max;
		if (editMode || mc.player == null) {
			health = 17.5F;
			max = 20;
		} else {
			health = mc.player.getHealth();
			max = mc.player.getMaxHealth();
		}

		return I18n.translate("sol_client.mod.health.text", trim(health), trim(max));
	}

	private static String trim(float value) {
		return value == (int) value ? Integer.toString((int) value) : String.format("%.1f", value);
	}

}
