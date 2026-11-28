// SkyView MIT-licensed adapter. The unmodified official pilot has its own EPL-2.0 license.
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;
import com.google.gson.*;
import org.eclipse.emf.ecore.resource.Resource;
import org.eclipse.xtext.nodemodel.util.NodeModelUtils;
import org.eclipse.xtext.resource.IResourceServiceProvider;
import org.eclipse.xtext.validation.CheckMode;
import org.eclipse.xtext.util.CancelIndicator;
import org.omg.sysml.interactive.SysMLInteractive;
import org.omg.sysml.lang.sysml.DecisionNode;
import org.omg.sysml.lang.sysml.Feature;
import org.omg.sysml.util.FeatureUtil;

public class SkyViewValidator {
    public static void main(String[] args) throws Exception {
        // Reserve stdout for exactly one structured response, including during pilot initialization.
        var output = System.out;
        System.setOut(System.err);
        var request = JsonParser.parseReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).getAsJsonObject();
        var files = request.getAsJsonObject("files");
        var engine = SysMLInteractive.getInstance();
        engine.setVerbose(false);
        engine.loadLibrary(args[0]);
        var resources = new LinkedHashMap<String, Resource>();
        var sources = new LinkedHashMap<String, String>();
        // Parse and index the complete project before resolving any reference, regardless of filename order.
        for (var entry : files.entrySet()) {
            String source = entry.getValue().getAsString();
            Resource resource = engine.createResource(Path.of("snapshot", entry.getKey()).toAbsolutePath().toString());
            resource.load(new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)), Map.of("ENCODING", "UTF-8"));
            engine.addInputResource(resource);
            engine.addResourceToIndex(resource);
            resources.put(entry.getKey(), resource);
            sources.put(entry.getKey(), source);
        }
        var diagnostics = new JsonArray();
        for (var entry : resources.entrySet()) {
            Resource resource = entry.getValue();
            var validator = IResourceServiceProvider.Registry.INSTANCE.getResourceServiceProvider(resource.getURI()).getResourceValidator();
            for (var issue : validator.validate(resource, CheckMode.ALL, CancelIndicator.NullImpl)) {
                if (issue.getSeverity().toString().equals("IGNORE")) continue;
                var d = new JsonObject();
                d.addProperty("file", entry.getKey());
                d.addProperty("severity", issue.getSeverity().toString().toLowerCase(Locale.ROOT));
                d.addProperty("message", issue.getMessage());
                d.addProperty("code", issue.getCode());
                d.addProperty("line", issue.getLineNumber());
                d.addProperty("column", issue.getColumn());
                d.addProperty("source", "Official SysML pilot");
                String source = sources.get(entry.getKey());
                if (issue.getOffset() != null && issue.getLength() != null) {
                    int start = Math.max(0, Math.min(source.length(), issue.getOffset()));
                    int end = Math.max(start, Math.min(source.length(), start + issue.getLength()));
                    var range = new JsonObject();
                    range.addProperty("start", source.substring(0, start).getBytes(StandardCharsets.UTF_8).length);
                    range.addProperty("end", source.substring(0, end).getBytes(StandardCharsets.UTF_8).length);
                    d.add("range", range);
                }
                diagnostics.add(d);
            }
        }
        // Native failures already explain an invalid model; avoid cascading checks on unresolved elements.
        boolean nativeErrors = false;
        for (var d : diagnostics) if (d.getAsJsonObject().get("severity").getAsString().equals("error")) nativeErrors = true;
        if (!nativeErrors) {
            supplement(resources, sources, diagnostics);
        }
        var result = new JsonObject();
        result.add("diagnostics", diagnostics);
        result.addProperty("filesChecked", resources.size());
        output.println(new Gson().toJson(result));
    }
    // OMG SysML 2.0 clauses 8.3.7 and 8.3.17. The pinned pilot leaves these
    // constraints as TODOs. Inspect resolved native elements, never source patterns.
    static void supplement(Map<String, Resource> resources, Map<String, String> sources, JsonArray diagnostics) {
        var elements = new ArrayList<org.eclipse.emf.ecore.EObject>();
        var names = new IdentityHashMap<Resource, String>();
        for (var entry : resources.entrySet()) {
            names.put(entry.getValue(), entry.getKey());
            entry.getValue().getAllContents().forEachRemaining(elements::add);
        }
        var incoming = new IdentityHashMap<org.omg.sysml.lang.sysml.Feature, Set<org.omg.sysml.lang.sysml.Succession>>();
        var outgoing = new IdentityHashMap<org.omg.sysml.lang.sysml.Feature, Set<org.omg.sysml.lang.sysml.Succession>>();
        for (var element : elements) {
            if (element instanceof org.omg.sysml.lang.sysml.Succession succession) {
                var source = succession.getSourceFeature();
                if (source != null) outgoing.computeIfAbsent(source, k -> new HashSet<>()).add(succession);
                if (source instanceof DecisionNode && succession.getConnectorEnd().size() == 2) {
                    var targetEnd = succession.getConnectorEnd().get(1);
                    // The decision context supplies 0..1 when the source omits target multiplicity.
                    // The pilot stores an explicit connector-end range on the owned cross feature.
                    for (var owned : targetEnd.getOwnedElement()) {
                        if (!(owned instanceof Feature cross)) continue;
                        var multiplicity = cross.getMultiplicity();
                        if (multiplicity == null || NodeModelUtils.getNode(multiplicity) == null) continue;
                        var range = FeatureUtil.getMultiplicityRangeOf(multiplicity);
                        if (range == null || !range.hasBounds(0, 1)) {
                            addRuleDiagnostic(multiplicity, "validateDecisionNodeOutgoingSuccessions",
                                "An outgoing succession from a decision node must have target multiplicity 0..1.",
                                names, sources, diagnostics);
                        }
                    }
                }
                for (var target : succession.getTargetFeature()) incoming.computeIfAbsent(target, k -> new HashSet<>()).add(succession);
            }
        }
        for (var element : elements) {
            if (element instanceof org.omg.sysml.lang.sysml.AttributeDefinition || element instanceof org.omg.sysml.lang.sysml.AttributeUsage) {
                var type = (org.omg.sysml.lang.sysml.Type) element;
                String code = element instanceof org.omg.sysml.lang.sysml.AttributeDefinition ? "validateAttributeDefinitionFeatures" : "validateAttributeUsageFeatures";
                for (var feature : type.getFeature()) {
                    if (!feature.isComposite()) continue;
                    boolean library = feature.eResource() != null && !names.containsKey(feature.eResource());
                    String name = String.valueOf(feature.getQualifiedName());
                    var d = addRuleDiagnostic(element, code,
                        library ? "Official standard library inherits a composite attribute feature: " + name + " (OMG SYSML21-19)."
                                : "Attribute features must be non-composite (referential): " + name + ".",
                        names, sources, diagnostics);
                    if (d != null && library) {
                        d.addProperty("origin", "standard-library");
                        d.addProperty("source", "Official library issue");
                    }
                }
            }
            String code = null;
            if (element instanceof DecisionNode && incoming.getOrDefault(element, Set.of()).size() > 1) code = "validateDecisionNodeIncomingSuccessions";
            if (element instanceof org.omg.sysml.lang.sysml.ForkNode && incoming.getOrDefault(element, Set.of()).size() > 1) code = "validateForkNodeIncomingSuccessions";
            if (element instanceof org.omg.sysml.lang.sysml.JoinNode && outgoing.getOrDefault(element, Set.of()).size() > 1) code = "validateJoinNodeOutgoingSuccessions";
            if (element instanceof org.omg.sysml.lang.sysml.MergeNode && outgoing.getOrDefault(element, Set.of()).size() > 1) code = "validateMergeNodeOutgoingSuccessions";
            if (code != null) addRuleDiagnostic(element, code, code.contains("Incoming") ? "This control node may have at most one incoming succession." : "This control node may have at most one outgoing succession.", names, sources, diagnostics);
        }
    }

    static JsonObject addRuleDiagnostic(org.eclipse.emf.ecore.EObject element, String code, String message,
            Map<Resource,String> names, Map<String,String> sources, JsonArray diagnostics) {
        var node = NodeModelUtils.findActualNodeFor(element);
        String name = names.get(element.eResource());
        if (node == null || name == null) return null; // No authored element in this project.
        String source = sources.get(name);
        int start = Math.min(source.length(), Math.max(0, node.getOffset()));
        int end = Math.min(source.length(), start + node.getLength());
        var d = new JsonObject();
        d.addProperty("file", name); d.addProperty("severity", "error");
        d.addProperty("message", message); d.addProperty("code", code);
        d.addProperty("line", node.getStartLine());
        int lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        d.addProperty("column", start - lineStart + 1);
        d.addProperty("source", "OMG SysML rule");
        var range = new JsonObject();
        range.addProperty("start", source.substring(0,start).getBytes(StandardCharsets.UTF_8).length);
        range.addProperty("end", source.substring(0,end).getBytes(StandardCharsets.UTF_8).length);
        d.add("range",range); diagnostics.add(d); return d;
    }
}
