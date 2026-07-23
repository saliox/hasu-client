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

import com.google.gson.annotations.Expose;

import io.github.solclient.client.mod.impl.SolClientSimpleHudMod;
import io.github.solclient.client.mod.option.annotation.Option;
import net.minecraft.util.math.MathHelper;

/**
 * Direction HUD (Azur Client) - displays the cardinal direction the player is
 * facing (same calculation as the coordinates HUD), optionally with the exact
 * angle.
 */
public final class DirectionMod extends SolClientSimpleHudMod {

	private static final String[] CARDINAL_DIRECTIONS = { "N", "NE", "E", "SE", "S", "SW", "W", "NW" };

	@Expose
	@Option
	private boolean degrees;

	@Override
	public String getText(boolean editMode) {
		double yaw = editMode || mc.player == null ? -90 : mc.player.yaw;
		int index = MathHelper.floor(((MathHelper.wrapDegrees(yaw) + 180D + 22.5D) % 360D) / 45D);

		String text = CARDINAL_DIRECTIONS[index];
		if (degrees)
			text += " (" + Math.round(MathHelper.wrapDegrees(yaw)) + "°)";
		return text;
	}

}
