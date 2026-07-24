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
import net.minecraft.util.math.MathHelper;

/**
 * Chunk position HUD (Azur Client) - displays the chunk the player is in and
 * the position within it, useful for farms and technical play.
 */
public final class ChunkPositionMod extends SolClientSimpleHudMod {

	@Override
	public String getText(boolean editMode) {
		int x, z;
		if (editMode || mc.player == null) {
			x = 8;
			z = -26;
		} else {
			x = MathHelper.floor(mc.player.x);
			z = MathHelper.floor(mc.player.z);
		}

		return "Chunk " + (x >> 4) + " " + (z >> 4) + " (" + (x & 15) + " " + (z & 15) + ")";
	}

}
