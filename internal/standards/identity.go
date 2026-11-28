package standards

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os/exec"
)

func releaseIdentity(r Release) string {
	b, _ := json.Marshal(r)
	return hashBytes(b)
}
func hashBytes(b []byte) string { return fmt.Sprintf("%x", sha256.Sum256(b)) }

type Identity struct {
	Release       Release `json:"release"`
	LockSHA256    string  `json:"lockSHA256"`
	AdapterSHA256 string  `json:"adapterSHA256"`
	State         string  `json:"state"`
	Error         string  `json:"error,omitempty"`
	Scope         string  `json:"scope"`
}

func BuildIdentity() Identity {
	return Identity{Release: Pinned(), LockSHA256: releaseIdentity(Pinned()), AdapterSHA256: hashBytes(bridge), State: "not-verified", Scope: "All official static validation checks plus SkyView's documented supplementary rules; full OMG conformance is not established."}
}
func (r *Runner) Identity() Identity {
	info := BuildIdentity()
	if err := Verify(r.Home); err != nil {
		info.State = "unavailable"
		info.Error = err.Error()
		return info
	}
	info.State = "verified"
	if _, err := exec.LookPath(r.Java); err != nil {
		info.State = "unavailable"
		info.Error = "Java is unavailable; native checking requires JDK 21+"
	}
	return info
}
