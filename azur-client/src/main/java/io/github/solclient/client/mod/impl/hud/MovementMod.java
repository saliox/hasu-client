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
 * Movement state HUD (Azur Client) - displays whether you are sprinting,
 * sneaking or walking (actual state, unlike the toggle indicators).
 */
public final class MovementMod extends SolClientSimpleHudMod {

	@Override
	public String getText(boolean editMode) {
		String key;
		if (editMode || mc.player == null)
			key = "sprinting";
		else if (mc.player.isSneaking())
			key = "sneaking";
		else if (mc.player.isSprinting())
			key = "sprinting";
		else
			key = "walking";

		return I18n.translate("sol_client.mod.movement." + key);
	}

}
