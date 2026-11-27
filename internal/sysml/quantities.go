package sysml

// Recognized standard-library identities and exact unit expressions. This is a
// bounded projection catalogue, not unit conversion or dimensional analysis.
// Other native-valid quantities retain an explicit unsupported diagnostic.
var quantityTypes = map[string]string{
	"ISQ::DurationValue":              "Duration",
	"ISQ::MassValue":                  "Mass",
	"ISQ::LengthValue":                "Length",
	"ISQ::SpeedValue":                 "Speed",
	"ISQ::AccelerationValue":          "Acceleration",
	"ISQ::AngularMeasureValue":        "Angle",
	"ISQ::AngularVelocityValue":       "AngularVelocity",
	"ISQ::ForceValue":                 "Force",
	"ISQ::MomentOfInertiaValue":       "Inertia",
	"ISQ::EnergyValue":                "Energy",
	"Quantities::ScalarQuantityValue": "Quantity",
}

var quantityUnits = map[string]string{
	"SI::s": "Duration", "SI::kg": "Mass", "SI::m": "Length",
	"SI::rad": "Angle", "SI::N": "Force", "SI::J": "Energy",
	"SI::m/SI::s": "Speed", "SI::m/SI::s^2": "Acceleration",
	"SI::rad/SI::s": "AngularVelocity", "SI::kg*SI::m^2": "Inertia",
	"SI::N*SI::s/SI::m": "Quantity", "SI::N*SI::m*SI::s/SI::rad": "Quantity",
	"SI::m/(SI::J*SI::s)": "Quantity", "1/SI::s^2": "Quantity", "1/SI::s": "Quantity",
}
