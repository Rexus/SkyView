"""Run all declared cart-pole experiments and fail if any mandatory check fails."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys
import numpy as np
from scipy.integrate import solve_ivp
from dynamics import CartPole, simulate, wrap
from model import BASE, load
from plots import responses, control_view

EXPECTED_EDGES = {('controller.command','actuator.command'),('actuator.force','sum.actuator'),
    ('disturbance.force','sum.disturbance'),('sum.total','plant.force'),('plant.motion','encoders.motion'),
    ('encoders.measurement','estimator.measurement'),('estimator.estimate','controller.estimate')}
EXPECTED_CHECKS = {'nominal':['acquireAndHold','respectLimits'],
                   'disturbance':['recoverFromPush','respectLimits'],'sensorLoss':['sensorLossDisables']}


def validate_inputs(model):
    if (len(model['connections']) != len(EXPECTED_EDGES) or
            {(e['source'],e['target']) for e in model['connections']} != EXPECTED_EDGES):
        raise ValueError('Native topology changed; update the numerical binding before running')
    expected = {k:[BASE+'Intent::'+v for v in vals] for k,vals in EXPECTED_CHECKS.items()}
    if model['verification'] != expected: raise ValueError('Verification binding changed')
    p = {name: entry['value'] for name,entry in model['parameters'].items()}
    signed = {'initialPosition','initialVelocity','initialAngle','initialAngularVelocity','disturbanceForce','kickForce'}
    for name,value in p.items():
        nonnegative = {'cartDamping','pivotDamping'}
        if (not np.isfinite(value) or (name in nonnegative and value < 0) or
                (name not in signed | nonnegative and value <= 0)):
            raise ValueError(f'Invalid parameter {name}')
    if not 0 < p['captureAngle'] < p['releaseAngle'] < np.pi:
        raise ValueError('Capture/release hysteresis must lie between zero and pi')
    if abs(p['initialPosition']) >= p['railHalfTravel']: raise ValueError('Initial cart outside rail')
    if not (p['kickDuration'] < p['acquisitionDeadline'] < p['disturbanceStart'] <
            p['disturbanceStart']+p['disturbanceDuration'] < p['recoveryDeadline'] < p['horizon']):
        raise ValueError('Experiment time ordering invalid')
    if not p['acquisitionDeadline'] < p['sensorFaultTime'] < p['horizon']:
        raise ValueError('Sensor fault must follow acquisition and precede horizon')
    for name in ('horizon','kickDuration','disturbanceStart','disturbanceDuration','sensorFaultTime',
                 'acquisitionDeadline','recoveryDeadline'):
        ticks = p[name]/p['samplePeriod']
        if not np.isclose(ticks,round(ticks),rtol=0,atol=1e-8):
            raise ValueError(f'{name} must align with samplePeriod in this runner')
    return p


def assess(data, completed, p, scenario):
    t = data[:,0]
    def held(since):
        window = data[t >= since]
        return bool(completed and len(window) and np.all(abs(window[:,1]) <= p['positionTolerance'])
                    and np.all(abs(wrap(window[:,3]-np.pi)) <= p['angleTolerance']))
    limits = bool(completed and np.max(abs(data[:,1])) < p['railHalfTravel']
                  and np.max(abs(data[:,[5,6]])) <= p['forceLimit']+1e-8)
    fault = data[t >= p['sensorFaultTime']]
    checks = {'acquireAndHold':held(p['acquisitionDeadline']),
              'recoverFromPush':held(p['recoveryDeadline']), 'respectLimits':limits,
              'sensorLossDisables':bool(completed and len(fault) and np.all(fault[:,6]==0) and np.all(fault[:,7]==2))}
    capture = data[data[:,7]==1,0]
    deadline = p['recoveryDeadline'] if scenario == 'disturbance' else p['acquisitionDeadline']
    window = data[t >= deadline]
    window_metrics = ({'since_s':deadline,'max_cart_m':float(np.max(abs(window[:,1]))),
                       'max_upright_error_rad':float(np.max(abs(wrap(window[:,3]-np.pi))))}
                      if len(window) and scenario != 'sensorLoss' else None)
    outputs = {'acquireAndHold':'acquiredAndHeld', 'recoverFromPush':'recoveredAndHeld',
               'respectLimits':'withinTravelAndForce', 'sensorLossDisables':'disabledOnSensorFault'}
    return {'observations':{BASE+'Experiment::'+outputs[n]:checks[n] for n in EXPECTED_CHECKS[scenario]},
            'hold_window':window_metrics,'completed':completed,'capture_s':float(capture[0]) if len(capture) else None,
            'max_cart_m':float(np.max(abs(data[:,1]))),'max_actuator_N':float(np.max(abs(data[:,5]))),
            'checks':{BASE+'Intent::'+name:checks[name] for name in EXPECTED_CHECKS[scenario]}}


def numerical_checks(p, nominal):
    plant = CartPole(p)
    A,B = plant.linearization(); equilibrium=np.array([0.,0.,np.pi,0.,0.])
    epsilon=1e-6
    jac=np.column_stack([(plant.rhs(equilibrium+np.eye(5)[i]*epsilon,0)[:4]-
                          plant.rhs(equilibrium-np.eye(5)[i]*epsilon,0)[:4])/(2*epsilon) for i in range(5)])
    undamped=CartPole(dict(p,cartDamping=0.,pivotDamping=0.))
    initial=np.array([0.,.1,.6,.2,0.])
    free=solve_ivp(lambda t,y:undamped.rhs(y,0),[0,10],initial,rtol=1e-10,atol=1e-12,max_step=.01)
    energy=undamped.energy(free.y.T)
    drift=float(np.max(abs(energy-energy[0])))
    refined,complete,_=simulate(p,'nominal',step_scale=.5)
    difference=np.max(abs(nominal[:,[1,3]]-refined[:,[1,3]]),axis=0) if nominal.shape==refined.shape else None
    return {'upright_linearization':bool(np.allclose(jac[:,:4],A,rtol=1e-6,atol=1e-8) and
                                         np.allclose(jac[:,4],B[:,0],rtol=1e-6,atol=1e-8)),
            'free_energy_conservation':bool(free.success and drift<1e-7),
            'halved_step_same_acceptance':bool(complete and all(assess(refined,complete,p,'nominal')['checks'].values())),
            'halved_step_trajectory':bool(difference is not None and np.all(difference<.005)),
            'energy_drift_J':drift,'max_refinement_position_m':float(difference[0]) if difference is not None else None,
            'max_refinement_angle_rad':float(difference[1]) if difference is not None else None}


def main():
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--output',type=Path,default=Path('bin/pendulum-results'))
    args=cli.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    report={'status':'running'}
    path=args.output/'report.json'
    def save(): path.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    save()  # A failed newest attempt never silently leaves an older passing report.
    try:
        model=load(); p=validate_inputs(model)
        report.update(source_sha256=model['source_sha256'],analysis=model['analysis'],
                      python=sys.version,packages={n:importlib.metadata.version(n) for n in ('numpy','scipy','matplotlib')},
                      implementation={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in Path(__file__).parent.glob('*.py')},
                      parameters=p,scenarios={})
        runs={}
        for scenario in EXPECTED_CHECKS:
            data,completed,gain=simulate(p,scenario); runs[scenario]=data
            report['scenarios'][scenario]=assess(data,completed,p,scenario)
            np.savetxt(args.output/(scenario+'.csv'),data,delimiter=',',comments='',
                       header='time_s,x_m,v_m_s,theta_rad,omega_rad_s,force_N,command_N,mode,disturbance_N,demand_N')
            report['lqr_gain']=gain.tolist(); save()
        report['numerics']=numerical_checks(p,runs['nominal'])
        checks=[v for r in report['scenarios'].values() for v in r['checks'].values()]
        checks += [v for v in report['numerics'].values() if isinstance(v,bool)]
        report['status']='passed' if all(checks) else 'failed'
        responses(runs,p,args.output/'response.svg')
        control_view(model,args.output/'control-loop.svg')
        save()
    except Exception as exc:
        report.update(status='failed',error=str(exc)); save(); raise
    print(json.dumps({k:report[k] for k in ('status','scenarios','numerics')},indent=2))
    return 0 if report['status']=='passed' else 1


if __name__=='__main__':
    raise SystemExit(main())
