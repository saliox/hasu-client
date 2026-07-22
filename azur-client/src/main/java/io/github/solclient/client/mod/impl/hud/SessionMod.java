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
import net.minecraft.client.resource.language.I18n;

/**
 * Session HUD (Azur Client) - displays how long the game has been running, in
 * the style of Lunar Client's session timer. Useful for streamers and grinders.
 */
public final class SessionMod extends SolClientSimpleHudMod {

	private final long start = System.currentTimeMillis();

	@Expose
	@Option
	private boolean seconds = true;

	@Override
	public String getText(boolean editMode) {
		long elapsed = editMode ? 5025000 : System.currentTimeMillis() - start;
		long totalSeconds = elapsed / 1000;
		long hours = totalSeconds / 3600;
		long minutes = (totalSeconds % 3600) / 60;

		String time;
		if (seconds)
			time = String.format("%dh %02dm %02ds", hours, minutes, totalSeconds % 60);
		else
			time = String.format("%dh %02dm", hours, minutes);

		return I18n.translate("sol_client.mod.session.text", time);
	}

}
