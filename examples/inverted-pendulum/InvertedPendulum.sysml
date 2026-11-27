package InvertedPendulum {
    doc /* Educational cart-on-a-rail swing-up and automatic balance experiment.
        The native model owns parameters, connections and acceptance intent.
        scripts/pendulum owns the numerical method and equations; see docs/pendulum-example.md.
        Angle is zero hanging down, pi radians upright; positive x is right.
        Rigid planar uniform rod, frictionless rolling contact plus viscous rail/pivot loss.
        No backlash, flexible modes, motor electrical circuit, thermal limits or hard-stop impact.
        Computational ports below carry signals, not conserving mechanical connections. */
    private import ScalarValues::*;

    package Parameters {
        attribute cartMass : ISQ::MassValue = 1[SI::kg];
        attribute rodMass : ISQ::MassValue = 0.2[SI::kg];
        attribute centerOfMass : ISQ::LengthValue = 0.5[SI::m];
        doc /* Uniform rod: total length = 2*centerOfMass; pivot inertia = 4*m*l*l/3.
            The runner derives inertia from this shape assumption, rather than an independent value. */
        attribute gravity : ISQ::AccelerationValue = 9.81[SI::m/SI::s^2];
        attribute cartDamping : Quantities::ScalarQuantityValue = 0.1[SI::N*SI::s/SI::m];
        attribute pivotDamping : Quantities::ScalarQuantityValue = 0.002[SI::N*SI::m*SI::s/SI::rad];
        attribute railHalfTravel : ISQ::LengthValue = 2.5[SI::m];
        attribute forceLimit : ISQ::ForceValue = 15[SI::N];
        attribute actuatorTimeConstant : ISQ::DurationValue = 0.02[SI::s];
        attribute samplePeriod : ISQ::DurationValue = 0.005[SI::s];
        attribute estimatorTimeConstant : ISQ::DurationValue = 0.02[SI::s];
        attribute positionResolution : ISQ::LengthValue = 0.0001[SI::m];
        attribute angleResolution : ISQ::AngularMeasureValue = 0.0001[SI::rad];
        attribute energyGain : Quantities::ScalarQuantityValue = 3[SI::m/(SI::J*SI::s)];
        attribute centeringGain : Quantities::ScalarQuantityValue = 0.5[1/SI::s^2];
        attribute velocityGain : Quantities::ScalarQuantityValue = 1[1/SI::s];
        attribute kickForce : ISQ::ForceValue = 3[SI::N];
        attribute kickDuration : ISQ::DurationValue = 0.25[SI::s];
        attribute captureAngle : ISQ::AngularMeasureValue = 0.55[SI::rad];
        attribute captureSpeed : ISQ::AngularVelocityValue = 2[SI::rad/SI::s];
        attribute releaseAngle : ISQ::AngularMeasureValue = 0.65[SI::rad];
        doc /* Continuous LQR cost weights apply to numerical states normalized by
            1 m, 1 m/s, 1 rad, 1 rad/s, and input normalized by 1 N. */
        attribute positionWeight : Real = 10;
        attribute velocityWeight : Real = 1;
        attribute angleWeight : Real = 80;
        attribute angularVelocityWeight : Real = 1;
        attribute forceWeight : Real = 0.2;
        attribute horizon : ISQ::DurationValue = 25[SI::s];
        attribute initialPosition : ISQ::LengthValue = 0[SI::m];
        attribute initialAngle : ISQ::AngularMeasureValue = 0[SI::rad];
        attribute initialVelocity : ISQ::SpeedValue = 0[SI::m/SI::s];
        attribute initialAngularVelocity : ISQ::AngularVelocityValue = 0[SI::rad/SI::s];
        attribute disturbanceStart : ISQ::DurationValue = 15[SI::s];
        attribute disturbanceDuration : ISQ::DurationValue = 0.2[SI::s];
        attribute disturbanceForce : ISQ::ForceValue = 1[SI::N];
        attribute sensorFaultTime : ISQ::DurationValue = 18[SI::s];
        attribute acquisitionDeadline : ISQ::DurationValue = 12[SI::s];
        attribute recoveryDeadline : ISQ::DurationValue = 20[SI::s];
        attribute angleTolerance : ISQ::AngularMeasureValue = 0.05[SI::rad];
        attribute positionTolerance : ISQ::LengthValue = 0.1[SI::m];
        attribute relativeTolerance : Real = 0.0000001;
        attribute absoluteTolerance : Real = 0.000000001;
    }

    package Mechanics {
        part def Rail {
            doc /* Horizontal guide; exceeding Parameters::railHalfTravel stops the experiment. */
        }
        part def Cart {
            attribute mass : ISQ::MassValue = Parameters::cartMass;
        }
        part def Rod {
            attribute mass : ISQ::MassValue = Parameters::rodMass;
            attribute centerOfMass : ISQ::LengthValue = Parameters::centerOfMass;
        }
        part def Pivot {
            doc /* One revolute degree of freedom, with viscous loss; mounted on the cart. */
        }
        part def Drive {
            doc /* Horizontal force actuator represented by force saturation and first-order lag. */
        }
        part def Encoder {
            doc /* Position or angle encoder; quantization and sampling modeled, no random noise. */
        }
        part def Assembly {
            part rail : Rail;
            part cart : Cart;
            part rod : Rod;
            part pivot : Pivot;
            part drive : Drive;
            part cartEncoder : Encoder;
            part pivotEncoder : Encoder;
            connection cartGuide connect cart to rail;
            connection cartPivot connect cart to pivot;
            connection pivotRod connect pivot to rod;
            connection driveCart connect drive to cart;
            connection positionMeasurement connect cart to cartEncoder;
            connection angleMeasurement connect pivot to pivotEncoder;
        }
    }

    package Signals {
        item def State {
            attribute position : ISQ::LengthValue;
            attribute velocity : ISQ::SpeedValue;
            attribute angle : ISQ::AngularMeasureValue;
            attribute angularVelocity : ISQ::AngularVelocityValue;
        }
        item def Measurement {
            attribute position : ISQ::LengthValue;
            attribute angle : ISQ::AngularMeasureValue;
            attribute valid : Boolean;
        }
        item def Estimate {
            attribute position : ISQ::LengthValue;
            attribute velocity : ISQ::SpeedValue;
            attribute angle : ISQ::AngularMeasureValue;
            attribute angularVelocity : ISQ::AngularVelocityValue;
            attribute valid : Boolean;
        }
        item def Force { attribute value : ISQ::ForceValue; }
        port def StateOut { out item value : State; }
        port def StateIn { in item value : State; }
        port def MeasurementOut { out item value : Measurement; }
        port def MeasurementIn { in item value : Measurement; }
        port def EstimateOut { out item value : Estimate; }
        port def EstimateIn { in item value : Estimate; }
        port def ForceOut { out item value : Force; }
        port def ForceIn { in item value : Force; }
    }

    package Blocks {
        part def Controller {
            doc /* Kick breaks the exact downward equilibrium; energy shaping with cart centering
                then captures with LQR. Angle/speed gates and release hysteresis select modes.
                Invalid sensing latches Disabled and commands zero; restart requires a new run. */
            port estimate : Signals::EstimateIn;
            port command : Signals::ForceOut;
        }
        part def Actuator {
            doc /* Saturation at +/-forceLimit followed by lag 1/(tau*s+1); zero initial force. */
            port command : Signals::ForceIn;
            port force : Signals::ForceOut;
        }
        part def ForceSum {
            doc /* Add actuator force and the externally applied horizontal disturbance. */
            port actuator : Signals::ForceIn;
            port disturbance : Signals::ForceIn;
            port total : Signals::ForceOut;
        }
        part def Plant {
            doc /* Coupled nonlinear cart/rod equations and state integration; not two independent plants.
                Includes gravity, uniform-rod inertia, centrifugal coupling, cart and pivot damping. */
            port force : Signals::ForceIn;
            port motion : Signals::StateOut;
        }
        part def Encoders {
            doc /* Sample and quantize position/angle; validity false at injected sensor fault.
                No angle wrapping in the measurement, no delay beyond the sampling period. */
            port motion : Signals::StateIn;
            port measurement : Signals::MeasurementOut;
        }
        part def Estimator {
            doc /* Backward differences of sampled positions with first-order low-pass velocity filters.
                Initial velocities equal the specified initial conditions. Validity propagates. */
            port measurement : Signals::MeasurementIn;
            port estimate : Signals::EstimateOut;
        }
        part def Disturbance {
            doc /* Zero in nominal run; rectangular horizontal force pulse in disturbance test. */
            port force : Signals::ForceOut;
        }
    }

    part def ControlLoop {
        part controller : Blocks::Controller;
        part actuator : Blocks::Actuator;
        part sum : Blocks::ForceSum;
        part plant : Blocks::Plant;
        part encoders : Blocks::Encoders;
        part estimator : Blocks::Estimator;
        part disturbance : Blocks::Disturbance;
        connection command connect controller.command to actuator.command;
        connection driveForce connect actuator.force to sum.actuator;
        connection externalForce connect disturbance.force to sum.disturbance;
        connection totalForce connect sum.total to plant.force;
        connection trueState connect plant.motion to encoders.motion;
        connection measurements connect encoders.measurement to estimator.measurement;
        connection feedback connect estimator.estimate to controller.estimate;
    }
    part def Experiment {
        part mechanics : Mechanics::Assembly;
        part control : ControlLoop;
        doc /* Observed results are supplied by the external runner, not preset passing values. */
        attribute acquiredAndHeld : Boolean;
        attribute recoveredAndHeld : Boolean;
        attribute withinTravelAndForce : Boolean;
        attribute disabledOnSensorFault : Boolean;
    }
    part experiment : Experiment;
    dependency numericalPlantRepresentsAssembly from ControlLoop::plant to Experiment::mechanics;

    package Intent {
        use case swingUpAndBalance {
            subject system : Experiment = experiment;
            objective {
                doc /* From downward rest, raise the pendulum and hold it upright near rail center;
                    recover from the specified horizontal force pulse without crossing the rail limits. */
            }
        }
        action operatingCycle {
            doc /* Nominal ordering. Controller gates and hysteresis are described in Blocks::Controller;
                this activity is intent, not an executable state-machine implementation. */
            first start;
            then action initialize;
            then action kick;
            then action shapeEnergy;
            then action capture;
            then action balance;
            then done;
        }
        requirement acquireAndHold {
            subject system : Experiment;
            doc /* IP-01: With nominal parameters and valid sensing, the experiment shall keep
                absolute upright angle error <= angleTolerance and absolute cart position <=
                positionTolerance at every control sample from acquisitionDeadline through horizon.
                Start at declared initial state. */
            require constraint { system.acquiredAndHeld }
        }
        requirement recoverFromPush {
            subject system : Experiment;
            doc /* IP-02: Apply disturbanceForce at disturbanceStart for disturbanceDuration.
                The experiment shall meet both balance tolerances at every control sample
                from recoveryDeadline through horizon. */
            require constraint { system.recoveredAndHeld }
        }
        requirement respectLimits {
            subject system : Experiment;
            doc /* IP-03: In nominal and push tests, absolute position shall stay strictly below
                railHalfTravel and absolute limited command and actual actuator force shall not exceed forceLimit.
                Crossing the travel boundary aborts simulation; no impact or hardware stopping is claimed. */
            require constraint { system.withinTravelAndForce }
        }
        requirement sensorLossDisables {
            subject system : Experiment;
            doc /* IP-04: On invalid sensing at sensorFaultTime, command shall be zero at the next
                sample and remain zero. Actual force decays with actuator lag; balance is not required
                after sensor loss. A new run is required to re-enable control. */
            require constraint { system.disabledOnSensorFault }
        }
    }
    package Studies {
        analysis swingUpResponse {
            subject system : Experiment = experiment;
            objective {
                doc /* External SciPy analysis: compare nominal, push and sensor-loss trajectories.
                    Results are JSON/CSV/SVG under the chosen output directory, bound to the source hash.
                    Method: sampled control, zero-order hold and RK45 integration, no stochastic inputs. */
            }
        }
        verification nominal {
            subject system : Experiment = experiment;
            objective { verify Intent::acquireAndHold; verify Intent::respectLimits; }
        }
        verification disturbance {
            subject system : Experiment = experiment;
            objective { verify Intent::recoverFromPush; verify Intent::respectLimits; }
        }
        verification sensorLoss {
            subject system : Experiment = experiment;
            objective { verify Intent::sensorLossDisables; }
        }
    }
}
