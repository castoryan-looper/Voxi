#pragma once
#include "runtime_config.h"
#include <WiFi.h>
#ifdef VOXI_BOARD_MINICAM
#include "minicam_modem.h"
#endif
inline bool radioUsesCellular(){
#ifdef VOXI_BOARD_MINICAM
 return radioConfig.networkMode=="cellular";
#else
 return false;
#endif
}
inline bool radioNetworkConnected(){
#ifdef VOXI_BOARD_MINICAM
 if(radioUsesCellular())return minicamModemReady();
#endif
 return WiFi.status()==WL_CONNECTED;
}
