"""Render the drone's linear message scenario from an official pilot JSON export.

No SysML text parsing or second authored model. Branches, cycles, implicit ordering
and participant-local messages need a different view and are rejected here.
"""

import argparse
import html
import json
from pathlib import Path


def project(raw):
    objects = {row["payload"]["@id"]: row["payload"] for row in raw}
    scope = next(e for e in objects.values()
                 if e.get("qualifiedName") == "InspectionDrone::Mission::nominalSequence")
    features = [objects[r["@id"]] for r in scope["ownedFeature"]]
    participants = [e for e in features if e["@type"] == "PartUsage"]
    messages = {e["@id"]: e for e in features if e["@type"] == "FlowUsage"}
    following, previous = {}, {}
    for edge in (e for e in features if e["@type"] == "SuccessionAsUsage"):
        source = edge["sourceFeature"]["@id"]
        targets = edge["targetFeature"]
        if len(targets) != 1:
            raise ValueError("Expected one succession target")
        target = targets[0]["@id"]
        if source not in messages or target not in messages or source in following or target in previous:
            raise ValueError("Expected a linear ordering of messages")
        following[source], previous[target] = target, source
    starts = set(messages) - set(previous)
    if len(starts) != 1:
        raise ValueError("Expected exactly one first message")
    ordered, current = [], starts.pop()
    while current:
        if current in ordered:
            raise ValueError("Cyclic sequence")
        ordered.append(current)
        current = following.get(current)
    if set(ordered) != set(messages):
        raise ValueError("Unordered messages would be omitted")
    participant_ids = {e["@id"] for e in participants}

    def endpoint(event):
        subset, = event["ownedSubsetting"]
        chain = objects[objects[subset["@id"]]["subsettedFeature"]["@id"]]["chainingFeature"]
        participant = chain[0]["@id"]
        if len(chain) != 2 or participant not in participant_ids:
            raise ValueError("Unsupported message endpoint")
        return participant

    rows = []
    for uid in ordered:
        msg = messages[uid]
        owned = [objects[r["@id"]] for r in msg["ownedFeature"]]
        source, = [e for e in owned if e.get("qualifiedName", "").endswith("::sourceEvent")]
        target, = [e for e in owned if e.get("qualifiedName", "").endswith("::targetEvent")]
        payload, = [e for e in owned if e["@type"] == "PayloadFeature"]
        typing, = [objects[r["@id"]] for r in payload["ownedRelationship"]
                   if objects[r["@id"]]["@type"] == "FeatureTyping"]
        payload_type = objects[typing["target"][0]["@id"]]["declaredName"]
        a, b = endpoint(source), endpoint(target)
        if a == b:
            raise ValueError("Self messages need a different layout")
        rows.append((a, b, msg["declaredName"], payload_type, msg["qualifiedName"]))
    return participants, rows


def render(participants, rows):
    if len(participants) != 3 or len(rows) > 8:
        raise ValueError("This compact example view supports three participants and up to eight messages")
    x = {e["@id"]: 160 + i * 320 for i, e in enumerate(participants)}
    height = 240 + len(rows) * 56
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="{height}" viewBox="0 0 960 {height}" role="img" aria-labelledby="title description">',
           '<title id="title">Inspection mission message sequence</title>',
           '<desc id="description">Generated from the native nominalSequence: ordered message exchanges between the ground station, flight controller and camera.</desc>',
           '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M1,1 L9,5 L1,9" fill="none" stroke="#397366" stroke-width="1.5"/></marker></defs>',
           f'<rect width="960" height="{height}" rx="12" fill="#f8fafc"/>',
           '<g font-family="Segoe UI,Arial,sans-serif" fill="#1f2937">',
           '<text x="32" y="39" font-size="24" font-weight="600">Inspection mission · message sequence</text>',
           '<text x="32" y="65" font-size="14">Expected scenario · generated from SysML v2 · no execution evidence</text>']
    for participant in participants:
        cx = x[participant["@id"]]
        name = html.escape(participant["declaredName"])
        svg += [f'<rect x="{cx-115}" y="95" width="230" height="48" rx="7" fill="#eef2f6" stroke="#64748b"/>',
                f'<text x="{cx}" y="125" font-size="17" text-anchor="middle">{name}</text>',
                f'<path d="M{cx},143 V{height-65}" stroke="#64748b" stroke-dasharray="5 5"/>']
    for i, (source, target, name, payload, identity) in enumerate(rows):
        y = 190 + i * 56
        label = html.escape(f"{i+1}. {name} : {payload}")
        svg += [f'<g data-model="{html.escape(identity)}"><title>{html.escape(identity)}</title>',
                f'<text x="{(x[source]+x[target])/2}" y="{y-12}" text-anchor="middle" font-size="14">{label}</text>',
                f'<path d="M{x[source]},{y} H{x[target]}" fill="none" stroke="#397366" stroke-width="2" marker-end="url(#arrow)"/></g>']
    svg += [f'<text x="32" y="{height-28}" font-size="12">InspectionDrone::Mission::nominalSequence · schematic notation, not a SkyView screenshot</text>', '</g></svg>']
    return "\n".join(svg) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("native_export", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    participants, rows = project(json.loads(args.native_export.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render(participants, rows), encoding="utf-8")
    print(f"Rendered {len(rows)} native messages between {len(participants)} participants")
