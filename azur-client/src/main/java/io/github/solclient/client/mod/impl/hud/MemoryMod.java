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

/**
 * Memory usage HUD (Azur Client) - displays the JVM heap usage, in the style of
 * Lunar Client's Memory mod.
 */
public final class MemoryMod extends SolClientSimpleHudMod {

	private static final long MEBIBYTE = 1024L * 1024L;

	@Expose
	@Option
	private boolean percentage;
	@Expose
	@Option
	private boolean showMax = true;

	@Override
	public String getText(boolean editMode) {
		Runtime runtime = Runtime.getRuntime();
		long used = runtime.totalMemory() - runtime.freeMemory();
		long max = runtime.maxMemory();

		if (percentage)
			return "RAM: " + Math.round(used * 100D / max) + "%";

		String result = "RAM: " + used / MEBIBYTE;
		if (showMax)
			result += "/" + max / MEBIBYTE;
		return result + " MB";
	}

}
