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

package io.github.solclient.client.mod.impl.weatherchanger;

import com.google.gson.annotations.Expose;

import io.github.solclient.client.mod.impl.StandardMod;
import io.github.solclient.client.mod.option.annotation.Option;

/**
 * Weather changer (Azur Client) - visually overrides the weather on your
 * screen, like the Time Changer mod does for the time of day. Purely visual:
 * the real server weather is unchanged.
 */
public final class WeatherChangerMod extends StandardMod {

	public static WeatherChangerMod instance;

	@Expose
	@Option
	private Weather weather = Weather.DEFAULT;

	@Override
	public void init() {
		super.init();
		instance = this;
	}

	/**
	 * @return the forced rain gradient, or null to keep the real weather.
	 */
	public static Float getRainOverride() {
		if (instance == null || !instance.isEnabled() || instance.weather == Weather.DEFAULT)
			return null;
		return instance.weather == Weather.CLEAR ? 0F : 1F;
	}

}
