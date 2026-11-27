import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.omg.sysml.interactive.SysMLInteractive;

/** Validate with the official pilot and export its resolved model for example previews. */
public class ExportSysML {
    public static void main(String[] args) throws Exception {
        if (args.length != 4) {
            throw new IllegalArgumentException("Usage: ExportSysML library source package output.json");
        }
        var engine = SysMLInteractive.getInstance();
        engine.loadLibrary(args[0]);
        var source = Files.readString(Path.of(args[1])).replace("\r\n", "\n").replace("\r", "\n");
        var result = engine.process(source);
        System.err.println(result);
        if (result.hasErrors()) System.exit(1);
        var exported = engine.export(args[2], List.of());
        if (!(exported instanceof com.google.gson.JsonElement json)) {
            throw new IllegalStateException("Native export failed: " + exported);
        }
        var output = Path.of(args[3]);
        Files.createDirectories(output.toAbsolutePath().getParent());
        Files.writeString(output, json.toString());
        var digest = java.security.MessageDigest.getInstance("SHA-256").digest(source.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Files.writeString(Path.of(args[3] + ".source.sha256"), java.util.HexFormat.of().formatHex(digest));
    }
}
