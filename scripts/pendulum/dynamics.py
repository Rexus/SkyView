"""Numerical implementation bound to InvertedPendulum::ControlLoop.

Downward angle convention, uniform rigid rod. See the model and guide for
assumptions. SI numerical values enter only through the native-model adapter.
"""
import numpy as np
from scipy.integrate import solve_ivp
from scipy.linalg import solve_continuous_are


def wrap(angle):
    return (angle + np.pi) % (2*np.pi) - np.pi


class CartPole:
    def __init__(self, p):
        self.p = p
        self.M, self.m, self.l = p['cartMass'], p['rodMass'], p['centerOfMass']
        self.J = 4*self.m*self.l**2/3  # Uniform rod about its end (parallel-axis theorem).
        self.b, self.d, self.g = p['cartDamping'], p['pivotDamping'], p['gravity']

    def rhs(self, state, command, disturbance=0.):
        x, v, theta, omega, force = state
        c, s = np.cos(theta), np.sin(theta)
        ml = self.m*self.l
        determinant = self.M+self.m-(ml*c)**2/self.J
        acceleration = (force+disturbance-self.b*v+ml*s*omega**2
                        +ml*c/self.J*(self.d*omega+ml*self.g*s))/determinant
        angular_acceleration = -(ml*c*acceleration+ml*self.g*s+self.d*omega)/self.J
        return np.array([v, acceleration, omega, angular_acceleration,
                         (command-force)/self.p['actuatorTimeConstant']])

    def energy(self, state):
        x, v, theta, omega, force = np.asarray(state).T
        return ((self.M+self.m)*v*v/2 + self.m*self.l*np.cos(theta)*v*omega
                + self.J*omega*omega/2 + self.m*self.g*self.l*(1-np.cos(theta)))

    def linearization(self):
        ml = self.m*self.l
        D = self.M+self.m-ml*ml/self.J
        A = np.zeros((4,4)); A[0,1] = A[2,3] = 1
        A[1,1] = -self.b/D
        A[1,2] = ml*ml*self.g/(self.J*D)
        A[1,3] = -ml*self.d/(self.J*D)
        A[3,1] = ml*A[1,1]/self.J
        A[3,2] = (ml*A[1,2]+ml*self.g)/self.J
        A[3,3] = (ml*A[1,3]-self.d)/self.J
        B = np.array([[0.], [1/D], [0.], [ml/(self.J*D)]])
        return A, B

    def gain(self):
        p = self.p
        A, B = self.linearization()
        Q = np.diag([p[n] for n in ('positionWeight','velocityWeight','angleWeight','angularVelocityWeight')])
        R = np.array([[p['forceWeight']]])
        return np.linalg.solve(R, B.T@solve_continuous_are(A,B,Q,R)).ravel()


class Controller:
    def __init__(self, plant, initial):
        self.plant, self.p, self.K = plant, plant.p, plant.gain()
        self.previous = initial[[0,2]].copy()
        self.velocity = initial[[1,3]].copy()
        self.mode = 0  # 0 energy swing-up, 1 balance, 2 disabled (latched).

    def sample(self, t, state, valid):
        p, plant = self.p, self.plant
        resolution = np.array([p['positionResolution'], p['angleResolution']])
        measured = np.round(state[[0,2]]/resolution)*resolution
        dt = p['samplePeriod']
        if t > 0:
            self.velocity += dt/(p['estimatorTimeConstant']+dt)*((measured-self.previous)/dt-self.velocity)
        self.previous = measured
        x, theta = measured; v, omega = self.velocity
        error = wrap(theta-np.pi)
        if not valid: self.mode = 2
        if self.mode == 0 and abs(error) < p['captureAngle'] and abs(omega) < p['captureSpeed']:
            self.mode = 1
        elif self.mode == 1 and abs(error) > p['releaseAngle']:
            self.mode = 0
        if self.mode == 2: return 0.
        if self.mode == 1:
            command = -self.K@np.array([x,v,error,omega])
        elif t < p['kickDuration']:
            command = p['kickForce']
        else:
            ml = plant.m*plant.l
            energy_error = plant.J*omega**2/2 + ml*plant.g*(1-np.cos(theta))-2*ml*plant.g
            desired_acceleration = (p['energyGain']*energy_error*omega*np.cos(theta)
                                    -p['centeringGain']*x-p['velocityGain']*v)
            D = plant.M+plant.m-(ml*np.cos(theta))**2/plant.J
            command = (D*desired_acceleration+plant.b*v-ml*np.sin(theta)*omega**2
                       -ml*np.cos(theta)/plant.J*(plant.d*omega+ml*plant.g*np.sin(theta)))
        return float(command)


def simulate(p, scenario, step_scale=1.):
    plant = CartPole(p)
    state = np.array([p['initialPosition'],p['initialVelocity'],p['initialAngle'],p['initialAngularVelocity'],0.])
    controller = Controller(plant, state)
    dt, horizon = p['samplePeriod'], p['horizon']
    def rail(t, y): return p['railHalfTravel']-abs(y[0])
    rail.terminal, rail.direction = True, -1
    rows, completed = [], True
    for index in range(round(horizon/dt)+1):
        t = index*dt
        valid = scenario != 'sensorLoss' or t < p['sensorFaultTime']
        demand = controller.sample(t,state,valid)
        command = float(np.clip(demand,-p['forceLimit'],p['forceLimit']))
        disturbance = (p['disturbanceForce'] if scenario == 'disturbance' and
                       p['disturbanceStart'] <= t < p['disturbanceStart']+p['disturbanceDuration'] else 0.)
        rows.append([t,*state,command,controller.mode,disturbance,demand])
        if index == round(horizon/dt): break
        sol = solve_ivp(lambda t,y: plant.rhs(y,command,disturbance), (t,t+dt), state,
                        method='RK45', rtol=p['relativeTolerance'], atol=p['absoluteTolerance'],
                        max_step=dt*step_scale, events=rail)
        if not sol.success: raise RuntimeError(sol.message)
        state = sol.y[:,-1]
        if sol.status == 1:
            rows.append([sol.t[-1],*state,command,controller.mode,disturbance,demand])
            completed = False
            break
    return np.array(rows), completed, controller.K
