#pragma once
#include <algorithm>
#include <array>
#include <stdint.h>

// Estimate the amount of audio a receiver must already have to ride out
// recent delivery shortfalls. Call with cumulative decoded audio in ms.
class AdaptivePlayback {
 public:
  static constexpr uint32_t initialMs=2000, maximumMs=6000;

  void begin(uint32_t now, uint32_t receivedMs=0) {
    sampleAt_=windowAt_=now;
    receivedMs_=receivedMs;
    deficitMs_=windowPeakMs_=0;
  }

  void observe(uint32_t now, uint32_t receivedMs, uint32_t bufferedMs) {
    const uint32_t elapsed=now-sampleAt_;
    if(elapsed<200)return;
    const uint32_t incoming=receivedMs-receivedMs_;
    sampleAt_=now;
    receivedMs_=receivedMs;
    // When the device has plenty of audio, the sender may pause on credit.
    // A pause that still leaves this reserve should not train the controller up.
    if(bufferedMs>=4000){
      deficitMs_=0;
    }else{
      const uint32_t need=deficitMs_+elapsed;
      deficitMs_=incoming>=need?0:std::min(need-incoming,maximumMs);
      windowPeakMs_=std::max(windowPeakMs_,deficitMs_);
    }
    if(now-windowAt_<2000)return;
    remember(windowPeakMs_);
    windowAt_=now;
    windowPeakMs_=deficitMs_;
  }

  void underrun() {
    // React to a real underrun without waiting for the next 2s window.
    refillHasReserve_=false;
    const uint32_t peak=std::max(deficitMs_,windowPeakMs_);
    remember(peak);
    startupMs_=std::max(startupMs_,targetFor(peak));
  }

  uint32_t startupMs() const {return startupMs_;}
  uint32_t deficitMs() const {return deficitMs_;}
  uint32_t recoveryMs(uint32_t packetGapMs=0) const {
    return std::clamp<uint32_t>(std::max({percentile(),deficitMs_,packetGapMs})+250,1000,4000);
  }

  bool resumeRefillEarly(uint32_t now, uint32_t bufferedMs, uint32_t targetMs) {
    // Give the normal watermark time to fill, but bound that wait once
    // there are two seconds of playable audio. A full target wins as usual.
    if(bufferedMs<2000){refillHasReserve_=false;return false;}
    if(bufferedMs>=targetMs)return false;
    if(!refillHasReserve_){refillHasReserve_=true;refillReserveAt_=now;}
    return now-refillReserveAt_>=1200;
  }

 private:
  static constexpr size_t windowCount=12;
  std::array<uint32_t,windowCount> peaks_{};
  size_t next_=0,count_=0;
  uint32_t sampleAt_=0,windowAt_=0,receivedMs_=0,deficitMs_=0,windowPeakMs_=0,startupMs_=initialMs;
  bool refillHasReserve_=false;
  uint32_t refillReserveAt_=0;

  uint32_t percentile() const {
    if(!count_)return 0;
    auto sorted=peaks_;
    std::sort(sorted.begin(),sorted.begin()+count_);
    return sorted[(count_*9+9)/10-1];
  }

  static uint32_t targetFor(uint32_t deficit) {
    return std::clamp<uint32_t>(deficit+250,750,maximumMs);
  }

  void remember(uint32_t peak) {
    peaks_[next_]=peak;
    next_=(next_+1)%windowCount;
    count_=std::min(count_+1,windowCount);
    const uint32_t wanted=targetFor(percentile());
    // Raise quickly, but learn lower targets only after several windows.
    if(wanted>startupMs_)startupMs_=wanted;
    else if(count_>=4)startupMs_=std::max(wanted,startupMs_-100);
  }
};
