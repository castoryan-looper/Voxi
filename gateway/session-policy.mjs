// Keep only authenticated, explicit connected-standby clients exempt from timed rotation.
export function rotateSession(mode,busy,standby){return !(mode==='pocket'&&(busy||standby==='connected-v1'));}
