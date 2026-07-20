package io.github.solclient.gradle.dist;

import static io.toadlabs.jfgjds.JsonGlobal.arr;
import static io.toadlabs.jfgjds.JsonGlobal.obj;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.gradle.api.Project;

import io.toadlabs.jfgjds.JsonSerializer;

// TODO multimc dist with advanced features bool or such
public final class PrismDist {

	private static final String UID = "io.github.solclient.wrapper";
	private static final String OPTIFINE_UID = "io.github.solclient.wrapper.optiflag";

	public static void export(DistTask task, Path input, Path output, Project project, String version)
			throws IOException {
		try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(output))) {
			Writer writer = new OutputStreamWriter(out, StandardCharsets.UTF_8);

			out.putNextEntry(new ZipEntry("mmc-pack.json"));
			// @formatter:off
			JsonSerializer.write(
					obj(
						"components", arr(
							obj(
								"uid", "org.lwjgl",
								"version", "2.9.4-nightly-20150209"
							),
							obj(
								"important", true,
								"uid", "net.minecraft",
								"version", "1.8.9"
							),
							obj( "uid", UID ),
							obj( "uid", OPTIFINE_UID )
						),
						"formatVersion", 1
					),
			writer);
			// @formatter:on

			out.putNextEntry(new ZipEntry("patches/" + UID + ".json"));
			// @formatter:off
			JsonSerializer.write(
					obj(
						"formatVersion", 1,
						"name", "Azur Client",
						"uid", UID,
						"version", version,
						"+libraries", arr(
							obj(
								"name", "io.github.solclient:wrapper:" + version,
								"MMC-hint", "local",
								"MMC-filename", "azur-client-wrapper.jar"
							)
						),
						// Réglages G1 éprouvés en 1.8.9 : limite les à-coups de GC (additifs,
						// n'écrasent pas les réglages Java globaux du joueur).
						"+jvmArgs", arr(
							"-XX:+UseG1GC", "-XX:+UnlockExperimentalVMOptions",
							"-XX:G1NewSizePercent=20", "-XX:G1ReservePercent=20",
							"-XX:MaxGCPauseMillis=50", "-XX:G1HeapRegionSize=32M"
						),
						"mainClass", "io.github.solclient.wrapper.Launcher"
					),
			writer);
			// @formatter:on

			out.putNextEntry(new ZipEntry("patches/" + OPTIFINE_UID + ".json"));
			// @formatter:off
			JsonSerializer.write(
					obj(
						"formatVersion", 1,
						"name", "OptiFine",
						"uid", OPTIFINE_UID,
						"version", "(default)",
						"+jvmArgs", arr( "-Dio.github.solclient.wrapper.optifine=true" )
					),
			writer);
			// @formatter:on

			out.putNextEntry(new ZipEntry("instance.cfg"));
			writer.write("InstanceType=OneSix\n");
			writer.write("name=Azur Client\n");
			writer.write("iconKey=azur\n");
			writer.flush();

			// Icône d'instance : le badge Azur, lu directement dans le jar du wrapper.
			try (java.util.zip.ZipFile wrapperZip = new java.util.zip.ZipFile(input.toFile())) {
				java.util.zip.ZipEntry icon = wrapperZip.getEntry("assets/sol_client/textures/gui/icon.png");
				if (icon != null) {
					out.putNextEntry(new ZipEntry("azur.png"));
					try (InputStream iconIn = wrapperZip.getInputStream(icon)) {
						iconIn.transferTo(out);
					}
				}
			}

			out.putNextEntry(new ZipEntry("libraries/azur-client-wrapper.jar"));
			try (InputStream wrapperIn = Files.newInputStream(input)) {
				wrapperIn.transferTo(out);
			}
		}
	}

}
