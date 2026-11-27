package ExampleModel {
    private import ScalarValues::*;

    doc /* A small, fictional SysML v2 model used as the SkyView sample. It
           exercises packages, definitions, usages, ports, attributes,
           documentation, connections and requirements. */

    package Organization {
        doc /* A fictional organization with one team. */

        part def Organization;
        part def Team;
        part def TeamMember;

        part def OrganizationContext {
            part org : Organization;
            part team : Team;
        }
    }

    package Facility {
        doc /* A fictional facility with a lab and a demonstration area. */

        part def Room;
        part def Rack;
        part def Server;

        part def ExampleFacility {
            part lab : Lab;
            part demoArea : DemoArea;
        }

        part def Lab specializes Room {
            doc /* The main laboratory. */
            part rackA : RackA;
            part rackB : RackB;
        }

        part def DemoArea specializes Room {
            doc /* The demonstration area. */
        }

        part def RackA specializes Rack {
            doc /* The primary compute rack. */
        }

        part def RackB specializes Rack {
            doc /* The secondary compute rack. */
        }
    }

    package Compute {
        doc /* A fictional two-node compute system with one serving engine. */

        port def ApiPort;

        part def ComputeNode specializes Facility::Server {
            doc /* A generic compute node with one API port. */
            attribute hostname : String;
            attribute ipAddress : String;
            port api : ApiPort;
        }

        part def ServingEngine {
            doc /* An inference engine exposing a single API port. */
            attribute engineVersion : String;
            attribute portNumber : Integer = 8080;
            port api : ApiPort;
        }

        part def ComputeSystem {
            part node1 : ComputeNode;
            part node2 : ComputeNode;
            part servingEngine : ServingEngine;

            connection node1Api connect node1.api to servingEngine.api;
            connection node2Api connect node2.api to servingEngine.api;
        }
    }

    package Requirements {
        doc /* Fictional requirements for the example system. */

        requirement def SingleEndpoint {
            doc /* The system shall expose a single API endpoint. */
        }

        requirement def LargeContext {
            doc /* The system shall support a large context window. */
        }

        requirement singleEndpoint : SingleEndpoint;
        requirement largeContext : LargeContext;

        part def RequirementsContext {
            part compute : Compute::ComputeSystem;

            satisfy singleEndpoint by compute.servingEngine;
            satisfy largeContext by compute.servingEngine;
        }
    }

    package System {
        doc /* The example system as a whole. */

        part def ExampleSystem {
            part organization : Organization::OrganizationContext;
            part facility : Facility::ExampleFacility;
            part compute : Compute::ComputeSystem;
        }

        part exampleSystem : ExampleSystem;
    }
}
