"""Project this example from an official SysML JSON export; never parse SysML text.

The compact generated input is shipped so running the example needs only Python.
Regeneration requires ExportSysML.java and the official pilot; see the guide.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'examples/inverted-pendulum/InvertedPendulum.sysml'
BASE = 'InvertedPendulum::'
# Dimensions: mass, length, time, angle. Angle is retained for signal checks.
UNITS = {
    'SI::kilogram': (1, 0, 0, 0), 'SI::metre': (0, 1, 0, 0),
    'SI::second': (0, 0, 1, 0), 'SI::radian': (0, 0, 0, 1),
    'SI::newton': (1, 1, -2, 0), 'SI::joule': (1, 2, -2, 0),
}
EXPECTED = {
    'cartMass': (1, 0, 0, 0), 'rodMass': (1, 0, 0, 0), 'centerOfMass': (0, 1, 0, 0),
    'gravity': (0, 1, -2, 0), 'cartDamping': (1, 0, -1, 0), 'pivotDamping': (1, 2, -1, -1),
    'energyGain': (-1, -1, 1, 0), 'centeringGain': (0, 0, -2, 0), 'velocityGain': (0, 0, -1, 0),
}
for names, dim in [
    ('railHalfTravel positionResolution initialPosition positionTolerance', (0, 1, 0, 0)),
    ('forceLimit kickForce disturbanceForce', (1, 1, -2, 0)),
    ('actuatorTimeConstant samplePeriod estimatorTimeConstant kickDuration horizon disturbanceStart '
     'disturbanceDuration sensorFaultTime acquisitionDeadline recoveryDeadline', (0, 0, 1, 0)),
    ('angleResolution captureAngle releaseAngle initialAngle angleTolerance', (0, 0, 0, 1)),
    ('captureSpeed initialAngularVelocity', (0, 0, -1, 1)),
    ('initialVelocity', (0, 1, -1, 0)),
    ('positionWeight velocityWeight angleWeight angularVelocityWeight forceWeight relativeTolerance absoluteTolerance', (0, 0, 0, 0)),
]:
    EXPECTED.update(dict.fromkeys(names.split(), dim))


def project(raw, source_hash):
    objects = {r['payload']['@id']: r['payload'] for r in raw}
    named = {e['qualifiedName']: e for e in objects.values() if e.get('qualifiedName')}
    def obj(ref): return objects[ref['@id']]
    def children(e): return [obj(r) for r in e.get('ownedFeature', [])]
    def typed(e):
        typ, = [obj(r) for r in e['type'] if (obj(r).get('qualifiedName') or '').startswith(BASE)]
        return typ
    def value(e):
        if e['@type'] in ('LiteralInteger', 'LiteralRational'):
            return float(e['value']), (0, 0, 0, 0)
        if e['@type'] == 'FeatureReferenceExpression':
            return 1., UNITS[obj(e['referent'])['qualifiedName']]
        args = [value(obj(r)) for r in e.get('argument', [])]
        if e.get('operator') == '-' and len(args) == 1:
            return -args[0][0], args[0][1]
        a, b = args
        if e.get('operator') in ('[', '*'):
            return a[0]*b[0], tuple(x+y for x,y in zip(a[1], b[1]))
        if e.get('operator') == '/':
            return a[0]/b[0], tuple(x-y for x,y in zip(a[1], b[1]))
        if e.get('operator') == '^' and b[1] == (0, 0, 0, 0) and b[0].is_integer():
            return a[0]**b[0], tuple(int(x*b[0]) for x in a[1])
        raise ValueError('Unsupported native parameter expression')

    parameters = {}
    for e in named.values():
        if e.get('@type') != 'AttributeUsage' or not e['qualifiedName'].startswith(BASE+'Parameters::'):
            continue
        feature_value, = [obj(r) for r in e['ownedRelationship'] if obj(r)['@type'] == 'FeatureValue']
        number, dimensions = value(obj(feature_value['value']))
        name = e['declaredName']
        if dimensions != EXPECTED[name] or not math.isfinite(number):
            raise ValueError(f'Unexpected units or number for {name}')
        parameters[name] = {'value': number, 'dimensions': dimensions, 'model': e['qualifiedName']}
    if parameters.keys() != EXPECTED.keys():
        raise ValueError('Runner/model parameter contract has changed')

    scope = named[BASE+'ControlLoop']
    blocks = []
    for e in children(scope):
        if e['@type'] == 'PartUsage':
            typ = typed(e)
            blocks.append({'name': e['declaredName'], 'model': e['qualifiedName'],
                           'type': typ['declaredName'],
                           'doc': '\n'.join(obj(r)['body'].strip() for r in typ['documentation'])})
    def endpoint(ref, direction):
        part, port = [obj(r) for r in obj(ref)['chainingFeature']]
        item, = children(typed(port))
        if item['direction'] != direction:
            raise ValueError('Signal endpoint direction changed')
        return part['declaredName']+'.'+port['declaredName'], typed(item)['declaredName']
    edges = []
    for e in children(scope):
        if e['@type'] != 'ConnectionUsage': continue
        a, kind = endpoint(e['sourceFeature'], 'out')
        target, = e['targetFeature']
        b, target_kind = endpoint(target, 'in')
        if kind != target_kind: raise ValueError('Incompatible signal payloads')
        edges.append({'source': a, 'target': b, 'payload': kind, 'model': e['qualifiedName']})
    checks = {}
    for e in named.values():
        if e['@type'] == 'VerificationCaseUsage' and e['qualifiedName'].startswith(BASE):
            checks[e['declaredName']] = [obj(r)['qualifiedName'] for r in e['verifiedRequirement']]
    named[BASE+'Studies::swingUpResponse']  # Require the declared analysis owner.
    return {'schema': 1, 'source_sha256': source_hash, 'analysis': BASE+'Studies::swingUpResponse',
            'parameters': parameters, 'blocks': blocks, 'connections': edges, 'verification': checks}


def load():
    data = json.loads(Path(__file__).with_name('model.json').read_text(encoding='utf-8'))
    if data['schema'] != 1 or data['source_sha256'] != hashlib.sha256(SOURCE.read_text(encoding='utf-8').encode('utf-8')).hexdigest():
        raise ValueError('Model inputs are stale; validate and regenerate as described in docs/pendulum-example.md')
    return data


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('native_export', type=Path)
    args = cli.parse_args()
    source_hash = hashlib.sha256(SOURCE.read_text(encoding='utf-8').encode('utf-8')).hexdigest()
    validated_hash = Path(str(args.native_export)+'.source.sha256').read_text().strip()
    if source_hash != validated_hash:
        raise ValueError('Native export is stale; validate the current source first')
    data = project(json.loads(args.native_export.read_text(encoding='utf-8')), source_hash)
    Path(__file__).with_name('model.json').write_text(json.dumps(data, indent=2, sort_keys=True)+'\n', encoding='utf-8')
    print(f"Projected {len(data['parameters'])} parameters and {len(data['connections'])} signal connections")
