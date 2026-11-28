package Deployment {
    doc /* SkyView uses the same workbench in the local Go, local container and CaaS deployments.
        The deployment guides own concrete build and operating commands. */
    private import ScalarValues::*;

    part def LocalRuntime {
        doc /* One local operator uses the Go executable or a container mapped to localhost.
            The local operator can explicitly attach a directory from their machine. */
    }
    part def HostedRuntime {
        doc /* The Kubernetes ingress terminates TLS. The application reads account credentials
            from a deployment secret and serves each account through its own workspace catalog.
            The initial root account adopts the pre-existing persistent workspace.
            Account configuration is administered by the deployment operator. One replica owns
            the filesystem state. Personal Git write credentials and collaborative project
            sharing are separate capabilities. */
        attribute privateResponsesRequireSignIn : Boolean;
        attribute accountsReachOnlyOwnWorkspace : Boolean;
        attribute rootRetainsExistingProjects : Boolean;
    }
    part local : LocalRuntime;
    part hosted : HostedRuntime;

    use case openLocalModel {
        subject deployment : LocalRuntime = local;
        objective { doc /* Start the workbench bound to localhost and open or import a model. */ }
    }
    use case signInToHostedWorkbench {
        subject deployment : HostedRuntime = hosted;
        objective { doc /* Sign in as root or a named account and open that account's projects. */ }
    }
    requirement hostedAccountIsolation {
        subject deployment : HostedRuntime;
        doc /* DP-01: Private responses shall require valid sign-in. Each signed-in account shall
            access only its own workspace and projects. The root account shall retain the existing
            workspace when switching a deployed instance to multi-user mode. */
        require constraint { deployment.privateResponsesRequireSignIn and
            deployment.accountsReachOnlyOwnWorkspace and deployment.rootRetainsExistingProjects }
    }
    verification hostedWorkspaceAccess {
        subject deployment : HostedRuntime;
        objective { verify hostedAccountIsolation; }
    }
}
