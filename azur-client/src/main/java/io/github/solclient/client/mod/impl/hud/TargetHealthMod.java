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
import net.minecraft.entity.LivingEntity;
import net.minecraft.util.hit.BlockHitResult.Type;

/**
 * Target health HUD (Azur Client) - displays the name and health of the living
 * entity under your crosshair (values already synced to the client for
 * rendering — nothing hidden is revealed).
 */
public final class TargetHealthMod extends SolClientSimpleHudMod {

	@Override
	public String getText(boolean editMode) {
		if (editMode)
			return I18n.translate("sol_client.mod.target_health.text", "Zombie", "12", "20");

		if (mc.result == null || mc.result.type != Type.ENTITY || !(mc.result.entity instanceof LivingEntity))
			return I18n.translate("sol_client.mod.target_health.none");

		LivingEntity target = (LivingEntity) mc.result.entity;
		return I18n.translate("sol_client.mod.target_health.text", target.getName().asFormattedString(),
				String.format("%.0f", target.getHealth()), String.format("%.0f", target.getMaxHealth()));
	}

}
