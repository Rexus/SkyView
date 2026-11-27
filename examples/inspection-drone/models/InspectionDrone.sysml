package InspectionDrone {
    doc /* Fictional inspection quadcopter for learning and testing SkyView.
        Sources and tool limitations: docs/drone-example.md in Rexus/SkyView.
        Numerical limits are example choices, not PX4 defaults or flight approval.
        Connections describe logical exchanges; power wiring and aerodynamics are omitted. */
    private import ScalarValues::*;

    package Components {
        item def MissionPlan;
        item def FlightCommand;
        item def Telemetry;
        item def PositionEstimate;
        item def MotorDemand;
        item def CameraCommand;
        item def ImageRecord;
        item def BatteryStatus;

        port def GroundLink {
            out item mission : MissionPlan;
            out item command : FlightCommand;
            in item telemetry : Telemetry;
        }
        port def AirLink {
            in item mission : MissionPlan;
            in item command : FlightCommand;
            out item telemetry : Telemetry;
        }
        port def PositionSource { out item position : PositionEstimate; }
        port def PositionSink { in item position : PositionEstimate; }
        port def MotorSource { out item demand : MotorDemand; }
        port def MotorSink { in item demand : MotorDemand; }
        port def CameraControl {
            out item command : CameraCommand;
            in item image : ImageRecord;
        }
        port def CameraDevice {
            in item command : CameraCommand;
            out item image : ImageRecord;
        }
        port def BatterySource { out item status : BatteryStatus; }
        port def BatterySink { in item status : BatteryStatus; }

        part def Pilot {
            doc /* External operator who approves the mission and supervises the flight. */
        }
        part def GroundStation {
            doc /* Uploads waypoints and displays vehicle telemetry. */
            port radio : GroundLink;
        }
        part def FlightController {
            doc /* Coordinates flight, imaging and return requests. */
            port radio : AirLink;
            port position : PositionSink;
            port motors : MotorSource;
            port camera : CameraControl;
            port battery : BatterySink;
        }
        part def Navigation {
            doc /* Estimates position and retains the launch location. */
            port position : PositionSource;
        }
        part def Propulsion {
            doc /* Converts motor demand into lift; detailed dynamics are outside this example. */
            attribute rotorCount : Integer = 4;
            port command : MotorSink;
        }
        part def Camera {
            doc /* Captures an inspection image on request. */
            port control : CameraDevice;
        }
        part def BatteryMonitor {
            doc /* Reports remaining charge as a fraction from zero to one. */
            port status : BatterySource;
        }
    }

    part def Drone {
        doc /* Five logical subsystems of a small inspection quadcopter. */
        part controller : Components::FlightController;
        part navigation : Components::Navigation;
        part propulsion : Components::Propulsion;
        part camera : Components::Camera;
        part battery : Components::BatteryMonitor;

        connection positionLink connect navigation.position to controller.position;
        connection motorLink connect controller.motors to propulsion.command;
        connection cameraLink connect controller.camera to camera.control;
        connection batteryLink connect battery.status to controller.battery;

        // Observable state for requirement evaluation; no simulator is supplied.
        attribute preflightPassed : Boolean;
        attribute armed : Boolean;
        attribute airborne : Boolean;
        attribute homeValid : Boolean;
        attribute batteryFraction : Real;
        attribute groundLinkAge : ISQ::DurationValue;
        attribute returnRequested : Boolean;
        attribute inspectionComplete : Boolean;
        attribute storedImageCount : Integer;
    }

    part def InspectionSystem {
        doc /* Vehicle and ground station; the pilot is an external role. */
        ref part pilot : Components::Pilot;
        part groundStation : Components::GroundStation;
        part drone : Drone;
        connection commandAndTelemetry connect groundStation.radio to drone.controller.radio;
    }
    part inspectionSystem : InspectionSystem;

    package Requirements {
        doc /* Design obligations, not verified results. Thresholds are fictional test inputs.
            Return requirements assume a usable home/position estimate and adequate control authority. */
        requirement preflightInterlock {
            doc /* DR-01: The drone shall remain disarmed while its preflight checks have not passed. */
            subject vehicle : Drone;
            require constraint { not vehicle.armed or vehicle.preflightPassed }
        }
        requirement batteryReserve {
            doc /* DR-02: While airborne with a valid home, the drone shall request return
                when its reported remaining battery fraction is at or below 0.20. */
            subject vehicle : Drone;
            require constraint {
                not vehicle.airborne or not vehicle.homeValid or
                vehicle.batteryFraction > 0.20 or vehicle.returnRequested
            }
        }
        requirement linkLossReturn {
            doc /* DR-03: While airborne with a valid home, the drone shall request return
                when the age of its last ground-station contact reaches 3 seconds. */
            subject vehicle : Drone;
            require constraint {
                not vehicle.airborne or not vehicle.homeValid or
                vehicle.groundLinkAge < 3[SI::s] or vehicle.returnRequested
            }
        }
        requirement inspectionEvidence {
            doc /* DR-04: The drone shall store at least one image before declaring inspection complete. */
            subject vehicle : Drone;
            require constraint { not vehicle.inspectionComplete or vehicle.storedImageCount >= 1 }
        }
    }

    // Satisfaction assertions express design intent; they are not test verdicts.
    satisfy Requirements::preflightInterlock by inspectionSystem.drone;
    satisfy Requirements::batteryReserve by inspectionSystem.drone;
    satisfy Requirements::linkLossReturn by inspectionSystem.drone;
    satisfy Requirements::inspectionEvidence by inspectionSystem.drone;

    package Mission {
        use case inspectSite {
            doc /* Pilot uploads a short waypoint mission, approves arming after preflight,
                obtains an image and recovers the vehicle. Low battery or lost ground contact
                interrupts inspection with a return request. Landing and disarming end the mission. */
            subject system : InspectionSystem = inspectionSystem;
            actor pilot : Components::Pilot = inspectionSystem.pilot;
            objective {
                doc /* Obtain an inspection image and recover the vehicle at the launch location. */
            }
        }

        action nominalMission {
            doc /* Success-only activity. Preconditions: approved plan, passed preflight,
                valid home, adequate charge. Failure handling is described by the requirements
                and the separate lost-link scenario. Actions are intent, not an executable autopilot. */
            first start;
            then action uploadPlan;
            then action checkPreflight;
            then action armAndTakeOff;
            then action captureImage;
            then action returnAndLand;
            then action disarm;
            then done;
        }

        occurrence nominalSequence {
            doc /* Ordered message scenario for a future sequence-diagram view.
                Event occurrences on each participant locate send/receive endpoints.
                Participants are bound to the structural design, not separate drone instances. */
            ref part station : Components::GroundStation = inspectionSystem.groundStation {
                event occurrence planSent;
                then event occurrence readyReceived;
                then event occurrence startSent;
                then event occurrence completionReceived;
            }
            ref part controller : Components::FlightController = inspectionSystem.drone.controller {
                event occurrence planReceived;
                then event occurrence readySent;
                then event occurrence startReceived;
                then event occurrence captureSent;
                then event occurrence imageReceived;
                then event occurrence completionSent;
            }
            ref part camera : Components::Camera = inspectionSystem.drone.camera {
                event occurrence captureReceived;
                then event occurrence imageSent;
            }
            message upload of Components::MissionPlan from station.planSent to controller.planReceived;
            message ready of Components::Telemetry from controller.readySent to station.readyReceived;
            message startMission of Components::FlightCommand from station.startSent to controller.startReceived;
            message capture of Components::CameraCommand from controller.captureSent to camera.captureReceived;
            message imageSaved of Components::ImageRecord from camera.imageSent to controller.imageReceived;
            message completed of Components::Telemetry from controller.completionSent to station.completionReceived;
            first upload then ready;
            first ready then startMission;
            first startMission then capture;
            first capture then imageSaved;
            first imageSaved then completed;
        }

        action lostGroundLink {
            doc /* Alternative scenario: while airborne with home valid, stop ground contact.
                At the 3-second threshold expect a return request. Restore contact afterwards;
                resuming inspection requires a new explicit operator decision. */
            first start;
            then action stopGroundContact;
            then action detectTimeout;
            then action requestReturn;
            then action recoverVehicle;
            then done;
        }

        state def FlightLifecycle {
            doc /* Nominal lifecycle sketch. Transition completion represents the modeled step;
                guards, event triggers and exceptional transitions remain future test coverage. */
            entry; then disarmed;
            state disarmed;
            then preflight;
            state preflight;
            then flying;
            state flying;
            then returning;
            state returning;
            then landed;
            state landed;
        }
    }

    package Verification {
        doc /* Planned checks only. No hardware, simulator or test verdict is included. */
        verification preflightCheck {
            doc /* Test DR-01 on a simulator: fail one preflight input and command arm.
                Pass if the armed indication remains false. Repeat with each failed input. */
            subject vehicle : Drone = inspectionSystem.drone;
            objective { verify Requirements::preflightInterlock; }
        }
        verification reserveCheck {
            doc /* Test DR-02 airborne with valid home: sweep charge through 0.21, 0.20 and 0.19.
                Pass if return is requested at 0.20 and 0.19. A request at 0.21 is permitted
                for other causes. No airborne hardware test is prescribed. */
            subject vehicle : Drone = inspectionSystem.drone;
            objective { verify Requirements::batteryReserve; }
        }
        verification lostLinkCheck {
            doc /* Test DR-03 in a simulator airborne with valid home: stop station heartbeats.
                Observe at link ages 2.9, 3.0 and 3.1 seconds; return must be requested at
                3.0 and 3.1. Record time resolution and state-sampling uncertainty. */
            subject vehicle : Drone = inspectionSystem.drone;
            objective { verify Requirements::linkLossReturn; }
        }
        verification imageCheck {
            doc /* Test DR-04 with zero images: completion must remain false. Supply one stored
                image and complete inspection; pass if completion is true and count is at least one. */
            subject vehicle : Drone = inspectionSystem.drone;
            objective { verify Requirements::inspectionEvidence; }
        }
    }
}
