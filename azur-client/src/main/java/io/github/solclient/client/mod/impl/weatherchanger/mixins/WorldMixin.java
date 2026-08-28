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

package io.github.solclient.client.mod.impl.weatherchanger.mixins;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import io.github.solclient.client.mod.impl.weatherchanger.WeatherChangerMod;
import net.minecraft.client.MinecraftClient;
import net.minecraft.world.World;

@Mixin(World.class)
public class WorldMixin {

	private final MinecraftClient mc = MinecraftClient.getInstance();

	// World est partagée par le rendu client ET, en solo, le serveur intégré tournant dans
	// le même JVM (WorldServer). Sans cette garde, l'override "purement visuel" changerait
	// aussi le gradient de pluie/foudre côté serveur intégré (même pattern de sécurité que
	// LevelPropertiesMixin pour le Time Changer).
	@Inject(method = "getRainGradient", at = @At("HEAD"), cancellable = true)
	public void azur$overrideRain(float delta, CallbackInfoReturnable<Float> callback) {
		if (mc.world == null || (Object) this != mc.world)
			return;
		Float override = WeatherChangerMod.getRainOverride();
		if (override != null)
			callback.setReturnValue(override);
	}

	@Inject(method = "getThunderGradient", at = @At("HEAD"), cancellable = true)
	public void azur$overrideThunder(float delta, CallbackInfoReturnable<Float> callback) {
		if (mc.world == null || (Object) this != mc.world)
			return;
		if (WeatherChangerMod.getRainOverride() != null)
			callback.setReturnValue(0F);
	}

}
