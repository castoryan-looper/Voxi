#pragma once

// Display levels are UI bands, not percentages or throughput estimates.
inline int minicamWifiBars(bool connected,int rssi){
 if(!connected||rssi>=0||rssi<-126)return 0;
 return rssi>=-60?4:rssi>=-70?3:rssi>=-80?2:1;
}
inline int minicamCellularBars(bool connected,int csq){
 if(!connected||csq<0||csq>31)return 0; // CSQ 99 means unknown.
 return csq>=20?4:csq>=15?3:csq>=10?2:1;
}

struct MiniCamBatteryStatus {
 int charging=-1,millivolts=-1,percent=-1;
 void sample(int batteryMv,int referenceMv,int referenceRaw){
  if(batteryMv<=0||referenceMv<=500||referenceRaw<=0||referenceRaw>4095){
   charging=millivolts=percent=-1;return;
  }
  // Same GPIO4 raw ADC threshold as the factory MiniCam implementation.
  // Do not compare this 12-bit raw threshold against calibrated millivolts.
  // A small release hysteresis avoids flicker around the charge-detect edge.
  charging=referenceRaw>2300?1:referenceRaw<=2200?0:charging<0?0:charging;
  millivolts=charging?batteryMv*2:batteryMv*2540/referenceMv;
  percent=(millivolts-3400)*100/800;
  if(percent<0)percent=0;
  if(percent>100)percent=100;
 }
};
