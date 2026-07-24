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

package io.github.solclient.client.mod.impl.nickhider;

import com.google.gson.annotations.Expose;

import io.github.solclient.client.mod.impl.StandardMod;
import io.github.solclient.client.mod.option.annotation.*;

/**
 * Nick hider (Azur Client) - hides or replaces your own name tag on your
 * screen (F5, mirrors), in the style of Lunar Client's Nick Hider. Purely
 * visual and client-side: other players still see your real name.
 */
public final class NickHiderMod extends StandardMod {

	public static NickHiderMod instance;

	@Expose
	@Option
	@TextField("sol_client.mod.nick_hider.hidden")
	private String nick = "";

	@Override
	public void init() {
		super.init();
		instance = this;
	}

	public static boolean shouldHideOwnName() {
		return instance != null && instance.isEnabled();
	}

	/**
	 * @return the replacement name, or null to hide the tag entirely.
	 */
	public static String getReplacement() {
		if (instance == null || instance.nick.trim().isEmpty())
			return null;
		return instance.nick.trim();
	}

}
