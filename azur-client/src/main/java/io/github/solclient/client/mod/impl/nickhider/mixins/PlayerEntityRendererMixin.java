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

package io.github.solclient.client.mod.impl.nickhider.mixins;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import io.github.solclient.client.mod.impl.nickhider.NickHiderMod;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.render.entity.PlayerEntityRenderer;

@Mixin(PlayerEntityRenderer.class)
public class PlayerEntityRendererMixin {

	// même cible que le levelhead Hypixel : le rendu du pseudo au-dessus du joueur
	@Inject(method = "method_10209(Lnet/minecraft/client/network/AbstractClientPlayerEntity;DDDLjava/lang/String;FD)V", at = @At("HEAD"), cancellable = true)
	public void azur$hideOwnName(AbstractClientPlayerEntity entity, double x, double y, double z, String str,
			float delta, double distance, CallbackInfo callback) {
		if (NickHiderMod.shouldHideOwnName() && entity == MinecraftClient.getInstance().player)
			callback.cancel();
	}

}
