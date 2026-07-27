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

import org.lwjgl.input.Keyboard;

import io.github.solclient.client.event.EventHandler;
import io.github.solclient.client.event.impl.PreTickEvent;
import io.github.solclient.client.mod.impl.SolClientSimpleHudMod;
import io.github.solclient.client.mod.option.annotation.Option;
import io.github.solclient.util.GlobalConstants;
import net.minecraft.client.option.KeyBinding;

/**
 * Stopwatch HUD (Azur Client) - a simple in-game stopwatch with start/pause and
 * reset keys, handy for speedruns, farms and challenges.
 */
public final class StopwatchMod extends SolClientSimpleHudMod {

	@Option
	private final KeyBinding toggleKey = new KeyBinding(getTranslationKey("toggle"), Keyboard.KEY_NONE,
			GlobalConstants.KEY_CATEGORY);
	@Option
	private final KeyBinding resetKey = new KeyBinding(getTranslationKey("reset"), Keyboard.KEY_NONE,
			GlobalConstants.KEY_CATEGORY);

	private boolean running;
	private long accumulated;
	private long startedAt;

	@EventHandler
	public void onTick(PreTickEvent event) {
		while (toggleKey.wasPressed()) {
			if (running)
				accumulated += System.currentTimeMillis() - startedAt;
			else
				startedAt = System.currentTimeMillis();
			running = !running;
		}
		while (resetKey.wasPressed()) {
			running = false;
			accumulated = 0;
		}
	}

	@Override
	public String getText(boolean editMode) {
		long elapsed = editMode ? 83450 : accumulated + (running ? System.currentTimeMillis() - startedAt : 0);
		long minutes = elapsed / 60000;
		long seconds = (elapsed % 60000) / 1000;
		long tenths = (elapsed % 1000) / 100;
		return String.format("%02d:%02d.%d", minutes, seconds, tenths);
	}

}
