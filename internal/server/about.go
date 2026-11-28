package server

import (
	"net/http"

	"github.com/Rexus/SkyView"
)

func aboutHandler(mode, account string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, struct {
			Build   skyview.Build `json:"build"`
			Mode    string        `json:"mode"`
			Account string        `json:"account"`
		}{skyview.Current(), mode, account})
	}
}
